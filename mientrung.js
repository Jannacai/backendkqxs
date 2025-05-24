const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const schedule = require('node-schedule');

require('dotenv').config();

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Đã kết nối MongoDB'))
    .catch(err => console.error('Lỗi kết nối MongoDB:', err));

// Hàm chuyển đổi tên tỉnh sang dạng kebab-case, hỗ trợ tiếng Việt
function toKebabCase(str) {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
}

// Định nghĩa schema cho kết quả xổ số miền Trung
const xsmtSchema = new mongoose.Schema({
    drawDate: { type: Date, required: true },
    dayOfWeek: { type: String },
    tentinh: { type: String, required: true },
    tinh: { type: String, required: true },
    slug: { type: String },
    year: { type: Number },
    month: { type: Number },
    eightPrizes: { type: [String] },
    sevenPrizes: { type: [String] },
    sixPrizes: { type: [String] },
    fivePrizes: { type: [String] },
    fourPrizes: { type: [String] },
    threePrizes: { type: [String] },
    secondPrize: { type: [String] },
    firstPrize: { type: [String] },
    specialPrize: { type: [String] },
    station: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
}, {
    indexes: [
        { key: { drawDate: 1, station: 1, tentinh: 1 }, unique: true },
        { key: { drawDate: -1 } },
        { key: { tentinh: 1 } },
        { key: { slug: 1 }, unique: true }, // Thêm chỉ số slug với unique
    ],
});

const XSMT = mongoose.model('XSMT', xsmtSchema);

// Hàm kiểm tra dữ liệu có đủ để lưu không
function hasAnyData(result) {
    return (
        result.tentinh && result.tentinh.length >= 1 && !result.tentinh.startsWith('Tỉnh_') &&
        (
            (result.specialPrize && result.specialPrize.length >= 1) ||
            (result.firstPrize && result.firstPrize.length >= 1) ||
            (result.secondPrize && result.secondPrize.length >= 1) ||
            (result.threePrizes && result.threePrizes.length >= 1) ||
            (result.fourPrizes && result.fourPrizes.length >= 1) ||
            (result.fivePrizes && result.fivePrizes.length >= 1) ||
            (result.sixPrizes && result.sixPrizes.length >= 1) ||
            (result.sevenPrizes && result.sevenPrizes.length >= 1) ||
            (result.eightPrizes && result.eightPrizes.length >= 1)
        )
    );
}

// Hàm kiểm tra dữ liệu đầy đủ cho một tỉnh
function isProvinceDataComplete(result) {
    return (
        (result.specialPrize && result.specialPrize.length >= 1) &&
        (result.firstPrize && result.firstPrize.length >= 1) &&
        (result.secondPrize && result.secondPrize.length >= 1) &&
        (result.threePrizes && result.threePrizes.length >= 2) &&
        (result.fourPrizes && result.fourPrizes.length >= 7) &&
        (result.fivePrizes && result.fivePrizes.length >= 1) &&
        (result.sixPrizes && result.sixPrizes.length >= 3) &&
        (result.sevenPrizes && result.sevenPrizes.length >= 1) &&
        (result.eightPrizes && result.eightPrizes.length >= 1)
    );
}

// Hàm log số lượng kết quả
function logDataDetails(result) {
    const expectedCounts = {
        eightPrizes: { actual: result.eightPrizes?.length || 0, expected: 1 },
        sevenPrizes: { actual: result.sevenPrizes?.length || 0, expected: 1 },
        sixPrizes: { actual: result.sixPrizes?.length || 0, expected: 3 },
        fivePrizes: { actual: result.fivePrizes?.length || 0, expected: 1 },
        fourPrizes: { actual: result.fourPrizes?.length || 0, expected: 7 },
        threePrizes: { actual: result.threePrizes?.length || 0, expected: 2 },
        secondPrize: { actual: result.secondPrize?.length || 0, expected: 1 },
        firstPrize: { actual: result.firstPrize?.length || 0, expected: 1 },
        specialPrize: { actual: result.specialPrize?.length || 0, expected: 1 },
    };

    console.log(`Chi tiết dữ liệu cho tỉnh ${result.tentinh}:`);
    for (const [prize, counts] of Object.entries(expectedCounts)) {
        console.log(`- ${prize}: ${counts.actual}/${counts.expected}${counts.actual < counts.expected ? ' (THIẾU)' : ''}`);
    }
}

// Hàm tạo độ trễ
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Hàm cào dữ liệu XSMT
async function scrapeXSMT(date, station) {
    let browser;
    let intervalId;
    let finalResults = [];
    let provincesList = [];

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
            ],
        });
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        });

        // Xác định URL dựa trên đài
        let baseUrl;
        if (station.toLowerCase() === 'xsmb') {
            baseUrl = 'https://xosovn.com/xsmb-';
        } else if (station.toLowerCase() === 'xsmn') {
            baseUrl = 'https://xosovn.com/xsmn-';
        } else if (station.toLowerCase() === 'xsmt') {
            baseUrl = 'https://xosovn.com/xsmt-';
        } else if (station.toLowerCase() === 'xsmblive') {
            baseUrl = 'https://xosovn.com/xsmb-xo-so-mien-bac';
        } else {
            throw new Error('Đài không hợp lệ. Vui lòng chọn: xsmb, xsmn, xsmt, hoặc xsmblive.');
        }

        // Tạo URL
        const formattedDate = date.split('/').join('-');
        const url = `${baseUrl}${formattedDate}`;
        console.log(`Đang cào dữ liệu từ: ${url}`);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Đợi cho đến khi ít nhất một thẻ <span> của giải 4 (v-g4-0) có nội dung
        try {
            await page.waitForFunction(
                () => {
                    const spans = document.querySelectorAll('span.v-g4-0');
                    return Array.from(spans).some(span => span.textContent.trim().length > 0);
                },
                { timeout: 60000 }
            );
            console.log('Đã tìm thấy dữ liệu cho giải 4, tiếp tục xử lý...');
        } catch (error) {
            console.log('Không tìm thấy dữ liệu cho giải 4 sau 60 giây, tiếp tục với dữ liệu hiện có...');
        }

        // Đợi thêm để đảm bảo dữ liệu khác tải xong
        await delay(10000);

        const scrapeAndSave = async () => {
            try {
                const html = await page.content();
                const $ = cheerio.load(html);

                // Tìm bảng kết quả
                const resultTable = $('table.kqsx-mt');

                if (resultTable.length === 0) {
                    console.log('Không tìm thấy bảng kết quả với class="kqsx-mt". Có thể trang không có dữ liệu hoặc cấu trúc HTML đã thay đổi.');
                    return;
                }

                // Lấy danh sách tỉnh từ hàng đầu tiên
                const provinceRow = resultTable.find('tr.bg-pr');
                const provinces = [];
                provinceRow.find('th').each((i, elem) => {
                    if (i === 0) return;
                    const provinceName = $(elem).find('a').text().trim();
                    if (provinceName) {
                        provinces.push(provinceName);
                    }
                });

                if (provinces.length === 0) {
                    console.log('Không tìm thấy tỉnh nào trong bảng kết quả.');
                    return;
                }

                provincesList = provinces;

                // Khởi tạo dữ liệu cho từng tỉnh
                const provincesData = {};
                provinces.forEach(province => {
                    provincesData[province] = {
                        specialPrize: [],
                        firstPrize: [],
                        secondPrize: [],
                        threePrizes: [],
                        fourPrizes: [],
                        fivePrizes: [],
                        sixPrizes: [],
                        sevenPrizes: [],
                        eightPrizes: [],
                    };
                });

                // Duyệt qua từng hàng trong bảng kết quả
                resultTable.find('tr').each((i, row) => {
                    const rowClass = $(row).attr('class') || 'undefined';
                    if (rowClass === 'bg-pr') return;

                    $(row).find('td').each((j, cell) => {
                        if (j === 0) return;
                        const province = provinces[j - 1];
                        if (!province) return;

                        const spans = $(cell).find('span');
                        if (spans.length === 0) return;

                        spans.each((k, span) => {
                            const spanClass = $(span).attr('class')?.trim();
                            const result = $(span).text().trim();
                            if (!spanClass || !result) return;

                            let prizeType;
                            let maxResults;

                            if (spanClass.includes('v-gdb')) {
                                prizeType = 'specialPrize';
                                maxResults = 1;
                            } else if (spanClass.includes('v-g1')) {
                                prizeType = 'firstPrize';
                                maxResults = 1;
                            } else if (spanClass.includes('v-g2')) {
                                prizeType = 'secondPrize';
                                maxResults = 1;
                            } else if (spanClass.includes('v-g3')) {
                                prizeType = 'threePrizes';
                                maxResults = 2;
                            } else if (spanClass.includes('v-g4')) {
                                prizeType = 'fourPrizes';
                                maxResults = 7;
                            } else if (spanClass.includes('v-g5')) {
                                prizeType = 'fivePrizes';
                                maxResults = 1;
                            } else if (spanClass.includes('v-g6')) {
                                prizeType = 'sixPrizes';
                                maxResults = 3;
                            } else if (spanClass.includes('v-g7')) {
                                prizeType = 'sevenPrizes';
                                maxResults = 1;
                            } else if (spanClass.includes('v-g8')) {
                                prizeType = 'eightPrizes';
                                maxResults = 1;
                            } else {
                                return;
                            }

                            const currentResults = provincesData[province][prizeType];
                            const remainingSlots = maxResults - currentResults.length;
                            if (remainingSlots <= 0) return;

                            currentResults.push(result);
                        });
                    });
                });

                // Lưu dữ liệu cho từng tỉnh và thu thập kết quả để log lần cuối
                finalResults = [];
                const drawDate = $('.ngay_quay, .draw-date, .date, h1.df-title').first().text().trim().match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || date;

                for (const tentinh of provinces) {
                    const dateObj = new Date(drawDate.split('/').reverse().join('-'));
                    const daysOfWeek = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
                    const dayOfWeek = daysOfWeek[dateObj.getDay()];
                    const tinh = toKebabCase(tentinh);
                    // Sửa slug để bao gồm tỉnh, ví dụ: xsmt-24-05-2025-khanh-hoa
                    const slug = `xsmt-${drawDate.replace(/\//g, '-')}-${tinh}`;

                    const result = {
                        drawDate,
                        slug,
                        year: dateObj.getFullYear(),
                        month: dateObj.getMonth() + 1,
                        dayOfWeek,
                        tentinh,
                        tinh,
                        specialPrize: provincesData[tentinh]?.specialPrize || [],
                        firstPrize: provincesData[tentinh]?.firstPrize || [],
                        secondPrize: provincesData[tentinh]?.secondPrize || [],
                        threePrizes: provincesData[tentinh]?.threePrizes || [],
                        fourPrizes: provincesData[tentinh]?.fourPrizes || [],
                        fivePrizes: provincesData[tentinh]?.fivePrizes || [],
                        sixPrizes: provincesData[tentinh]?.sixPrizes || [],
                        sevenPrizes: provincesData[tentinh]?.sevenPrizes || [],
                        eightPrizes: provincesData[tentinh]?.eightPrizes || [],
                        station,
                    };

                    finalResults.push(result);

                    if (hasAnyData(result)) {
                        await saveToMongoDB(result);
                    }
                }

                // Kiểm tra xem dữ liệu đã đầy đủ cho ít nhất một tỉnh chưa
                const anyProvinceComplete = provinces.some(province => {
                    const result = provincesData[province];
                    return isProvinceDataComplete(result);
                });

                if (anyProvinceComplete) {
                    console.log('Dữ liệu đã đầy đủ cho ít nhất một tỉnh, dừng cào.');
                    clearInterval(intervalId);
                    await browser.close();
                }
            } catch (error) {
                console.error('Lỗi khi cào dữ liệu:', error.message);
            }
        };

        intervalId = setInterval(scrapeAndSave, 5000);

        setTimeout(async () => {
            clearInterval(intervalId);
            console.log('Dừng cào dữ liệu sau 5 phút.');
            if (provincesList.length > 0 && finalResults.length > 0) {
                console.log(`Tìm thấy ${provincesList.length} tỉnh: ${provincesList.join(', ')}`);
                for (const result of finalResults) {
                    logDataDetails(result);
                }
            }
            await browser.close();
        }, 5 * 60 * 1000);

    } catch (error) {
        console.error('Lỗi khi khởi động:', error.message);
        if (browser) await browser.close();
    }
}

// Hàm lưu vào MongoDB
async function saveToMongoDB(result) {
    try {
        const dateParts = result.drawDate.split('/');
        const dateObj = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
        result.drawDate = dateObj;

        const existingResult = await XSMT.findOne({ drawDate: dateObj, station: result.station, tentinh: result.tentinh });

        if (existingResult) {
            const existingData = {
                specialPrize: existingResult.specialPrize,
                firstPrize: existingResult.firstPrize,
                secondPrize: existingResult.secondPrize,
                threePrizes: existingResult.threePrizes,
                fourPrizes: existingResult.fourPrizes,
                fivePrizes: existingResult.fivePrizes,
                sixPrizes: existingResult.sixPrizes,
                sevenPrizes: existingResult.sevenPrizes,
                eightPrizes: existingResult.eightPrizes,
            };

            const newData = {
                specialPrize: result.specialPrize,
                firstPrize: result.firstPrize,
                secondPrize: result.secondPrize,
                threePrizes: result.threePrizes,
                fourPrizes: result.fourPrizes,
                fivePrizes: result.fivePrizes,
                sixPrizes: result.sixPrizes,
                sevenPrizes: result.sevenPrizes,
                eightPrizes: result.eightPrizes,
            };

            const existingDataString = JSON.stringify(existingData);
            const newDataString = JSON.stringify(newData);

            if (existingDataString !== newDataString) {
                await XSMT.updateOne(
                    { drawDate: dateObj, station: result.station, tentinh: result.tentinh },
                    { $set: result }
                );
                console.log(`Đã cập nhật kết quả ngày ${result.drawDate.toISOString().split('T')[0]} cho tỉnh: ${result.tentinh}`);
            } else {
                console.log(`Dữ liệu ngày ${result.drawDate.toISOString().split('T')[0]} cho tỉnh ${result.tentinh} không thay đổi`);
            }
        } else {
            const latestResult = await XSMT.findOne({
                station: result.station,
                tentinh: result.tentinh,
                drawDate: { $lt: dateObj },
            }).sort({ drawDate: -1 });

            if (latestResult) {
                const latestData = {
                    specialPrize: latestResult.specialPrize,
                    firstPrize: latestResult.firstPrize,
                    secondPrize: latestResult.secondPrize,
                    threePrizes: latestResult.threePrizes,
                    fourPrizes: latestResult.fourPrizes,
                    fivePrizes: latestResult.fivePrizes,
                    sixPrizes: latestResult.sixPrizes,
                    sevenPrizes: latestResult.sevenPrizes,
                    eightPrizes: latestResult.eightPrizes,
                };

                const newData = {
                    specialPrize: result.specialPrize,
                    firstPrize: result.firstPrize,
                    secondPrize: result.secondPrize,
                    threePrizes: result.threePrizes,
                    fourPrizes: result.fourPrizes,
                    fivePrizes: result.fivePrizes,
                    sixPrizes: result.sixPrizes,
                    sevenPrizes: result.sevenPrizes,
                    eightPrizes: result.eightPrizes,
                };

                const latestDataString = JSON.stringify(latestData);
                const newDataString = JSON.stringify(newData);

                if (latestDataString !== newDataString) {
                    let retryCount = 0;
                    while (retryCount < 3) {
                        try {
                            const newResult = new XSMT(result);
                            await newResult.save();
                            console.log(`Đã lưu kết quả mới ngày ${result.drawDate.toISOString().split('T')[0]} cho tỉnh ${result.tentinh}`);
                            break;
                        } catch (error) {
                            if (error.code === 11000 && error.keyPattern?.slug && retryCount < 3) {
                                retryCount++;
                                result.slug = `xsmt-${drawDate.replace(/\//g, '-')}-${tinh}-${retryCount}`;
                                console.log(`Xung đột slug, thử lại với slug mới: ${result.slug}`);
                            } else {
                                throw error;
                            }
                        }
                    }
                } else {
                    console.log(`Dữ liệu ngày ${result.drawDate.toISOString().split('T')[0]} cho tỉnh ${result.tentinh} không thay đổi so với ngày gần nhất`);
                }
            } else {
                let retryCount = 0;
                while (retryCount < 3) {
                    try {
                        const newResult = new XSMT(result);
                        await newResult.save();
                        console.log(`Đã lưu kết quả mới ngày ${result.drawDate.toISOString().split('T')[0]} cho tỉnh ${result.tentinh} (không có dữ liệu trước đó)`);
                        break;
                    } catch (error) {
                        if (error.code === 11000 && error.keyPattern?.slug && retryCount < 3) {
                            retryCount++;
                            result.slug = `xsmt-${drawDate.replace(/\//g, '-')}-${tinh}-${retryCount}`;
                            console.log(`Xung đột slug, thử lại với slug mới: ${result.slug}`);
                        } else {
                            throw error;
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error(`Lỗi khi lưu vào MongoDB cho tỉnh ${result.tentinh}:`, error.message);
    }
}

// Lên lịch chạy tự động lúc 17h00 hàng ngày
schedule.scheduleJob('0 17 * * *', () => {
    console.log('Bắt đầu cào dữ liệu XSMT...');
    const today = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    scrapeXSMT(today, 'xsmt');
});

// Chạy thủ công nếu có tham số dòng lệnh
const [, , date, station] = process.argv;
if (date && station) {
    console.log(`Chạy thủ công cho ngày ${date} và đài ${station}`);
    scrapeXSMT(date, station);
} else {
    console.log('Nếu muốn chạy thủ công, dùng lệnh: node xsmt_scraper.js 19/04/2025 xsmt');
}

// Đóng kết nối MongoDB khi dừng chương trình
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('Đã đóng kết nối MongoDB');
    process.exit(0);
});