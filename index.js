const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const { lock, unlock } = require('proper-lockfile');
const fs = require('fs');
const path = require('path');
const redis = require('redis');
require('dotenv').config();

const XSMB = require('./src/models/XS_MB.models');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/xsmb', {
    maxPoolSize: 10,
    minPoolSize: 2,
}).then(() => console.log('Đã kết nối MongoDB')).catch(err => console.error('Lỗi kết nối MongoDB:', err));

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => console.error('Lỗi kết nối Redis:', err));

const lockFilePath = path.resolve(__dirname, 'scraper.lock');
const ensureLockFile = () => {
    try {
        if (!fs.existsSync(lockFilePath)) {
            fs.writeFileSync(lockFilePath, '');
            console.log(`Tạo file ${lockFilePath}`);
        }
    } catch (error) {
        console.error(`Lỗi khi tạo file ${lockFilePath}:`, error.message);
        throw error;
    }
};

function isDataComplete(result) {
    return (
        result.maDB && result.maDB !== '...' &&
        result.tentinh && result.tentinh.length >= 1 &&
        result.specialPrize && result.specialPrize.length >= 1 && !result.specialPrize.includes('...') &&
        result.firstPrize && result.firstPrize.length >= 1 && !result.firstPrize.includes('...') &&
        result.secondPrize && result.secondPrize.length >= 2 && !result.secondPrize.includes('...') &&
        result.threePrizes && result.threePrizes.length >= 6 && !result.threePrizes.includes('...') &&
        result.fourPrizes && result.fourPrizes.length >= 4 && !result.fourPrizes.includes('...') &&
        result.fivePrizes && result.fivePrizes.length >= 6 && !result.fivePrizes.includes('...') &&
        result.sixPrizes && result.sixPrizes.length >= 3 && !result.sixPrizes.includes('...') &&
        result.sevenPrizes && result.sevenPrizes.length >= 4 && !result.sevenPrizes.includes('...')
    );
}

async function publishToRedis(prizeType, prizeData, additionalData) {
    const { drawDate, tentinh, tinh, year, month } = additionalData;
    const today = new Date(drawDate).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).replace(/\//g, '-');
    const message = JSON.stringify({
        prizeType,
        prizeData,
        drawDate: today,
        tentinh,
        tinh,
        year,
        month,
    });
    console.log(`Chuẩn bị gửi Redis: ${prizeType}`, prizeData, `Kênh: xsmb:${today}`);
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
        try {
            if (!redisClient.isOpen) {
                console.log('Redis client chưa sẵn sàng, kết nối lại...');
                await redisClient.connect();
            }
            await redisClient.publish(`xsmb:${today}`, message);
            console.log(`Đã gửi ${prizeType} qua Redis cho ngày ${today}`);
            await redisClient.hSet(`kqxs:${today}`, prizeType, JSON.stringify(prizeData));
            console.log(`Đã lưu ${prizeType} vào hash kqxs:${today}`);
            await redisClient.hSet(`kqxs:${today}:meta`, 'metadata', JSON.stringify({ tentinh, tinh, year, month }));
            console.log(`Đã lưu metadata vào kqxs:${today}:meta`);
            await redisClient.expire(`kqxs:${today}`, 7200);
            await redisClient.expire(`kqxs:${today}:meta`, 7200);
            break;
        } catch (error) {
            attempts++;
            console.warn(`Lỗi gửi Redis lần ${attempts} (${prizeType}):`, error.message);
            if (attempts === maxAttempts) {
                console.error(`Không thể gửi ${prizeType} qua Redis sau ${maxAttempts} lần thử`);
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

async function scrapeXSMB(date, station) {
    let browser;
    let intervalId;
    let release;
    try {
        const dateParts = date.split('/');
        const dateObj = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
        const formattedDate = date.replace(/\//g, '-');

        ensureLockFile();
        release = await lock(lockFilePath, { retries: 5 });

        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            defaultViewport: { width: 1280, height: 720 },
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        let baseUrl, dateHash;
        if (station.toLowerCase() === 'xsmb') {
            baseUrl = `https://xosovn.com/xsmb-${formattedDate}`;
            dateHash = `#kqngay_${formattedDate.split('-').join('')}`;
            console.log(`Đang cào dữ liệu từ: ${baseUrl}`);
        } else {
            throw new Error('Chỉ hỗ trợ đài xsmb trong phiên bản này');
        }

        let attempt = 0;
        const maxAttempts = 5;
        while (attempt < maxAttempts) {
            try {
                await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                break;
            } catch (error) {
                attempt++;
                console.warn(`Lỗi request lần ${attempt}: ${error.message}. Thử lại...`);
                if (attempt === maxAttempts) throw error;
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        const scrapeAndSave = async () => {
            try {
                const now = new Date();
                const isLiveWindow = now.getHours() === 18 && now.getMinutes() >= 15 && now.getMinutes() <= 35;
                const intervalMs = isLiveWindow ? 10000 : 30000;

                const result = await page.evaluate((dateHash) => {
                    const getPrizes = (selector) => {
                        const elements = document.querySelectorAll(selector);
                        return Array.from(elements).map(elem => elem.textContent.trim()).filter(prize => prize);
                    };

                    return {
                        drawDate: document.querySelector('.ngay_quay')?.textContent.trim() || '',
                        maDB: document.querySelector(`${dateHash} span[class*="v-madb"]`)?.textContent.trim() || '...',
                        specialPrize: getPrizes(`${dateHash} span[class*="v-gdb"]`),
                        firstPrize: getPrizes(`${dateHash} span[class*="v-g1"]`),
                        secondPrize: getPrizes(`${dateHash} span[class*="v-g2-"]`),
                        threePrizes: getPrizes(`${dateHash} span[class*="v-g3-"]`),
                        fourPrizes: getPrizes(`${dateHash} span[class*="v-g4-"]`),
                        fivePrizes: getPrizes(`${dateHash} span[class*="v-g5-"]`),
                        sixPrizes: getPrizes(`${dateHash} span[class*="v-g6-"]`),
                        sevenPrizes: getPrizes(`${dateHash} span[class*="v-g7-"]`),
                    };
                }, dateHash);

                const dayOfWeekIndex = dateObj.getDay();
                let tinh, tentinh;
                switch (dayOfWeekIndex) {
                    case 0: tinh = 'thai-binh'; tentinh = 'Thái Bình'; break;
                    case 1: tinh = 'ha-noi'; tentinh = 'Hà Nội'; break;
                    case 2: tinh = 'quang-ninh'; tentinh = 'Quảng Ninh'; break;
                    case 3: tinh = 'bac-ninh'; tentinh = 'Bắc Ninh'; break;
                    case 4: tinh = 'ha-noi'; tentinh = 'Hà Nội'; break;
                    case 5: tinh = 'hai-phong'; tentinh = 'Hải Phòng'; break;
                    case 6: tinh = 'nam-dinh'; tentinh = 'Nam Định'; break;
                    default: throw new Error('Không xác định được ngày trong tuần');
                }

                const slug = `${station}-${formattedDate}`;
                const dayOfWeek = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][dayOfWeekIndex];

                const formattedResult = {
                    drawDate: dateObj,
                    slug,
                    year: dateObj.getFullYear(),
                    month: dateObj.getMonth() + 1,
                    dayOfWeek,
                    maDB: result.maDB || '...',
                    tentinh,
                    tinh,
                    specialPrize: result.specialPrize.length ? result.specialPrize : ['...'],
                    firstPrize: result.firstPrize.length ? result.firstPrize : ['...'],
                    secondPrize: result.secondPrize.length ? result.secondPrize : ['...', '...'],
                    threePrizes: result.threePrizes.length ? result.threePrizes : ['...', '...', '...', '...', '...', '...'],
                    fourPrizes: result.fourPrizes.length ? result.fourPrizes : ['...', '...', '...', '...'],
                    fivePrizes: result.fivePrizes.length ? result.fivePrizes : ['...', '...', '...', '...', '...', '...'],
                    sixPrizes: result.sixPrizes.length ? result.sixPrizes : ['...', '...', '...'],
                    sevenPrizes: result.sevenPrizes.length ? result.sevenPrizes : ['...', '...', '...', '...'],
                    station,
                    createdAt: new Date(),
                };

                const prizeTypes = [
                    { key: 'maDB', data: formattedResult.maDB },
                    { key: 'specialPrize', data: formattedResult.specialPrize },
                    { key: 'firstPrize', data: formattedResult.firstPrize },
                    { key: 'secondPrize', data: formattedResult.secondPrize },
                    { key: 'threePrizes', data: formattedResult.threePrizes },
                    { key: 'fourPrizes', data: formattedResult.fourPrizes },
                    { key: 'fivePrizes', data: formattedResult.fivePrizes },
                    { key: 'sixPrizes', data: formattedResult.sixPrizes },
                    { key: 'sevenPrizes', data: formattedResult.sevenPrizes },
                ];

                for (const { key, data } of prizeTypes) {
                    if (data && !data.includes('...')) {
                        await publishToRedis(key, data, formattedResult);
                    }
                }

                if (
                    formattedResult.maDB !== '...' ||
                    formattedResult.specialPrize.some(prize => prize !== '...') ||
                    formattedResult.firstPrize.some(prize => prize !== '...') ||
                    formattedResult.secondPrize.some(prize => prize !== '...')
                ) {
                    await saveToMongoDB(formattedResult);
                } else {
                    console.log(`Dữ liệu ngày ${date} cho ${station} chưa có, tiếp tục cào...`);
                }

                if (isDataComplete(formattedResult)) {
                    console.log(`Dữ liệu ngày ${date} cho ${station} đã đầy đủ, dừng cào.`);
                    clearInterval(intervalId);
                    await browser.close();
                    await release();
                }

                clearInterval(intervalId);
                intervalId = setInterval(scrapeAndSave, intervalMs);
            } catch (error) {
                console.error(`Lỗi khi cào dữ liệu ngày ${date}:`, error.message);
            }
        };

        intervalId = setInterval(scrapeAndSave, 10000);

        setTimeout(async () => {
            clearInterval(intervalId);
            console.log(`Dừng cào dữ liệu ngày ${date} sau 20 phút`);
            if (browser) await browser.close();
            if (release) await release();
        }, 20 * 60 * 1000);

    } catch (error) {
        console.error(`Lỗi khi khởi động scraper ngày ${date}:`, error.message);
        if (browser) await browser.close();
        if (release) await release();
    }
}

async function saveToMongoDB(result) {
    try {
        const existingResult = await XSMB.findOne({ drawDate: result.drawDate, station: result.station }).lean();

        if (existingResult) {
            const existingData = {
                maDB: existingResult.maDB,
                specialPrize: existingResult.specialPrize,
                firstPrize: existingResult.firstPrize,
                secondPrize: existingResult.secondPrize,
                threePrizes: existingResult.threePrizes,
                fourPrizes: existingResult.fourPrizes,
                fivePrizes: existingResult.fivePrizes,
                sixPrizes: existingResult.sixPrizes,
                sevenPrizes: existingResult.sevenPrizes,
            };

            const newData = {
                maDB: result.maDB,
                specialPrize: result.specialPrize,
                firstPrize: result.firstPrize,
                secondPrize: result.secondPrize,
                threePrizes: result.threePrizes,
                fourPrizes: result.fourPrizes,
                fivePrizes: result.fivePrizes,
                sixPrizes: result.sixPrizes,
                sevenPrizes: result.sevenPrizes,
            };

            if (JSON.stringify(existingData) !== JSON.stringify(newData)) {
                await XSMB.updateOne(
                    { drawDate: result.drawDate, station: result.station },
                    { $set: result },
                    { upsert: true }
                );
                console.log(`Cập nhật kết quả ngày ${result.drawDate.toISOString().split('T')[0]} cho ${result.station}`);

                // Xóa cache Redis liên quan đến specialPrizeByWeek
                try {
                    const cacheKeys = await redisClient.keys('specialPrizeByWeek:xsmb:*');
                    if (cacheKeys.length > 0) {
                        await redisClient.del(cacheKeys);
                        console.log(`Đã xóa ${cacheKeys.length} cache keys specialPrizeByWeek:xsmb:*`);
                    } else {
                        console.log('Không tìm thấy cache keys specialPrizeByWeek:xsmb:* để xóa');
                    }
                } catch (cacheError) {
                    console.error('Lỗi khi xóa cache Redis:', cacheError.message);
                }
            } else {
                console.log(`Dữ liệu ngày ${result.drawDate.toISOString().split('T')[0]} cho ${result.station} không thay đổi`);
            }
        } else {
            await XSMB.create(result);
            console.log(`Lưu kết quả mới ngày ${result.drawDate.toISOString().split('T')[0]} cho ${result.station}`);

            // Xóa cache Redis liên quan đến specialPrizeByWeek
            try {
                const cacheKeys = await redisClient.keys('specialPrizeByWeek:xsmb:*');
                if (cacheKeys.length > 0) {
                    await redisClient.del(cacheKeys);
                    console.log(`Đã xóa ${cacheKeys.length} cache keys specialPrizeByWeek:xsmb:*`);
                } else {
                    console.log('Không tìm thấy cache keys specialPrizeByWeek:xsmb:* để xóa');
                }
            } catch (cacheError) {
                console.error('Lỗi khi xóa cache Redis:', cacheError.message);
            }
        }
    } catch (error) {
        console.error(`Lỗi khi lưu dữ liệu ngày ${result.drawDate.toISOString().split('T')[0]}:`, error.message);
    }
}

// Xuất hàm scrapeXSMB
module.exports = { scrapeXSMB };

// Chạy thủ công nếu có tham số dòng lệnh
const [, , date, station] = process.argv;
if (date && station) {
    console.log(`Chạy thủ công cho ngày ${date} và đài ${station}`);
    scrapeXSMB(date, station);
} else {
    console.log('Chạy thủ công: node xsmbScraper.js 29/02/2025 xsmb');
}

process.on('SIGINT', async () => {
    await mongoose.connection.close();
    await redisClient.quit();
    console.log('Đã đóng kết nối MongoDB và Redis');
    process.exit(0);
});