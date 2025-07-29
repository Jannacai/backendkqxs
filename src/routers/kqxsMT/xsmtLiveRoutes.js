const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const { broadcastLotteryUpdate, broadcastLotteryError, getLotterySubscribersCount } = require('../../websocket');

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

const retryOperation = async (operation, maxRetries = 3, delay = 1000) => {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.error(`Thử lần ${attempt}/${maxRetries} thất bại:`, error.message);
            if (attempt === maxRetries) break;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
};

const connectRedis = async () => {
    if (!redisClient.isOpen) {
        await retryOperation(() => redisClient.connect(), 3, 1000);
    }
};
connectRedis().catch(err => console.error('Lỗi kết nối Redis:', err));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: { error: 'Quá nhiều yêu cầu API, vui lòng thử lại sau một phút.' },
});

const provincesByDay = {
    0: { 'kon-tum': { tentinh: 'Kon Tum', tinh: 'kon-tum' }, 'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' }, 'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' } },
    1: { 'phu-yen': { tentinh: 'Phú Yên', tinh: 'phu-yen' }, 'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' } },
    2: { 'dak-lak': { tentinh: 'Đắk Lắk', tinh: 'dak-lak' }, 'quang-nam': { tentinh: 'Quảng Nam', tinh: 'quang-nam' } },
    3: { 'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' }, 'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' } },
    4: { 'binh-dinh': { tentinh: 'Bình Định', tinh: 'binh-dinh' }, 'quang-tri': { tentinh: 'Quảng Trị', tinh: 'quang-tri' }, 'quang-binh': { tentinh: 'Quảng Bình', tinh: 'quang-binh' } },
    5: { 'gia-lai': { tentinh: 'Gia Lai', tinh: 'gia-lai' }, 'ninh-thuan': { tentinh: 'Ninh Thuận', tinh: 'ninh-thuan' } },
    6: { 'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' }, 'quang-ngai': { tentinh: 'Quảng Ngãi', tinh: 'quang-ngai' }, 'dak-nong': { tentinh: 'Đắk Nông', tinh: 'dak-nong' } },
};

const parseDate = (dateStr) => {
    if (!dateStr || !/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        throw new Error('Định dạng ngày không hợp lệ. Vui lòng sử dụng DD-MM-YYYY.');
    }
    const [day, month, year] = dateStr.split('-').map(Number);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > new Date().getFullYear()) {
        throw new Error('Ngày, tháng hoặc năm không hợp lệ.');
    }
    return new Date(year, month - 1, day);
};

router.get('/initial', apiLimiter, async (req, res) => {
    try {
        const { date, station = 'xsmt', tinh } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const province = provincesByDay[new Date(parseDate(targetDate)).getDay()]?.[tinh];
        if (!province || !tinh) {
            return res.status(400).json({ error: 'Tỉnh không hợp lệ hoặc không được cung cấp.' });
        }

        let existingData = await redisClient.hGetAll(`kqxs:${station}:${targetDate}:${tinh}`);
        const latestData = await redisClient.get(`kqxs:${station}:${targetDate}:${tinh}:latest`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:${station}:${targetDate}:${tinh}:meta`, 'metadata')) || '{}');

        console.log(`Debug - Redis keys for kqxs:${station}:${targetDate}:${tinh}:`);
        console.log(`existingData keys:`, Object.keys(existingData));
        console.log(`existingData values:`, existingData);
        console.log(`latestData exists:`, !!latestData);
        console.log(`metadata:`, metadata);

        const initialData = {
            eightPrizes_0: '...',
            sevenPrizes_0: '...',
            sixPrizes_0: '...',
            sixPrizes_1: '...',
            sixPrizes_2: '...',
            fivePrizes_0: '...',
            fourPrizes_0: '...',
            fourPrizes_1: '...',
            fourPrizes_2: '...',
            fourPrizes_3: '...',
            fourPrizes_4: '...',
            fourPrizes_5: '...',
            fourPrizes_6: '...',
            threePrizes_0: '...',
            threePrizes_1: '...',
            secondPrize_0: '...',
            firstPrize_0: '...',
            specialPrize_0: '...',
            drawDate: targetDate,
            station,
            tentinh: province.tentinh,
            tinh: province.tinh,
            year: metadata.year || new Date().getFullYear(),
            month: metadata.month || new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: metadata.lastUpdated || 0,
        };

        // Ưu tiên đọc từ existingData trước
        if (existingData && Object.keys(existingData).length > 0) {
            console.log(`Reading from existingData for kqxs:${station}:${targetDate}:${tinh}:`, existingData);
            for (const key of Object.keys(existingData)) {
                if (initialData.hasOwnProperty(key)) {
                    try {
                        const parsedValue = JSON.parse(existingData[key]);
                        initialData[key] = parsedValue;
                        console.log(`Set ${key} = ${parsedValue}`);
                    } catch (e) {
                        console.error(`Error parsing Redis data for kqxs:${station}:${targetDate}:${tinh}, key ${key}:`, e);
                        initialData[key] = existingData[key];
                    }
                }
            }
        } else if (latestData) {
            // Nếu không có existingData, thử đọc từ latestData
            try {
                const parsedLatest = JSON.parse(latestData);
                console.log(`Reading from latestData for kqxs:${station}:${targetDate}:${tinh}:`, parsedLatest);
                for (const key of Object.keys(parsedLatest)) {
                    if (initialData.hasOwnProperty(key)) {
                        initialData[key] = parsedLatest[key];
                    }
                }
                initialData.lastUpdated = parsedLatest.lastUpdated || Date.now();
            } catch (e) {
                console.error(`Error parsing latestData for kqxs:${station}:${targetDate}:${tinh}:`, e);
            }
        }

        console.log(`Final initial data for kqxs:${station}:${targetDate}:${tinh}:`, initialData);
        res.status(200).json(initialData);
    } catch (error) {
        console.error('Error fetching initial state from Redis:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    }
});

// Endpoint cập nhật kết quả xổ số (thay thế SSE)
router.post('/update', apiLimiter, async (req, res) => {
    try {
        const { station = 'xsmt', date, tinh, prizeType, prizeData, additionalData = {} } = req.body;

        console.log(`=== REALTIME UPDATE REQUEST ===`);
        console.log(`Station: ${station}`);
        console.log(`Date: ${date}`);
        console.log(`Tinh: ${tinh}`);
        console.log(`Prize Type: ${prizeType}`);
        console.log(`Prize Data: ${prizeData}`);
        console.log(`Additional Data:`, additionalData);

        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        const province = provincesByDay[new Date(parseDate(targetDate)).getDay()]?.[tinh];
        if (!province || !tinh || !prizeType || !prizeData) {
            console.error(`Invalid update request:`, { province, tinh, prizeType, prizeData });
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
        }

        console.log(`Province found:`, province);

        // Cập nhật Redis
        await redisClient.hSet(`kqxs:${station}:${targetDate}:${tinh}`, prizeType, JSON.stringify(prizeData));
        await redisClient.hSet(`kqxs:${station}:${targetDate}:${tinh}:meta`, 'metadata', JSON.stringify({
            ...additionalData,
            lastUpdated: Date.now(),
        }));
        await redisClient.expire(`kqxs:${station}:${targetDate}:${tinh}`, 86400);
        await redisClient.expire(`kqxs:${station}:${targetDate}:${tinh}:meta`, 86400);

        // Publish to Redis channel for realtime updates
        const publishData = {
            station,
            date: targetDate,
            tinh,
            prizeType,
            prizeData,
            timestamp: Date.now()
        };

        console.log(`=== PUBLISHING TO REDIS CHANNEL ===`);
        console.log(`Channel: lottery:${station}:updates`);
        console.log(`Data:`, publishData);

        await redisClient.publish(`lottery:${station}:updates`, JSON.stringify(publishData));
        console.log(`Successfully published to Redis channel: lottery:${station}:updates`);

        // Cập nhật dữ liệu mới nhất
        let latestData = await redisClient.get(`kqxs:${station}:${targetDate}:${tinh}:latest`);
        let fullData = latestData ? JSON.parse(latestData) : {
            drawDate: targetDate,
            station,
            tentinh: province.tentinh,
            tinh: province.tinh,
            year: additionalData.year || new Date().getFullYear(),
            month: additionalData.month || new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: 0,
            eightPrizes_0: '...',
            sevenPrizes_0: '...',
            sixPrizes_0: '...',
            sixPrizes_1: '...',
            sixPrizes_2: '...',
            fivePrizes_0: '...',
            fourPrizes_0: '...',
            fourPrizes_1: '...',
            fourPrizes_2: '...',
            fourPrizes_3: '...',
            fourPrizes_4: '...',
            fourPrizes_5: '...',
            fourPrizes_6: '...',
            threePrizes_0: '...',
            threePrizes_1: '...',
            secondPrize_0: '...',
            firstPrize_0: '...',
            specialPrize_0: '...',
        };
        fullData[prizeType] = prizeData;
        fullData.lastUpdated = Date.now();

        await redisClient.set(`kqxs:${station}:${targetDate}:${tinh}:latest`, JSON.stringify(fullData));
        await redisClient.expire(`kqxs:${station}:${targetDate}:${tinh}:latest`, 86400);

        // Broadcast qua WebSocket - gửi dạng mảng để khớp với client
        const broadcastData = [fullData];
        console.log(`=== BROADCASTING REALTIME UPDATE ===`);
        console.log(`Broadcast data:`, broadcastData);
        console.log(`Broadcast data length:`, broadcastData.length);
        console.log(`Broadcast data structure:`, broadcastData.map(item => ({
            tinh: item.tinh,
            tentinh: item.tentinh,
            [prizeType]: item[prizeType]
        })));

        await broadcastLotteryUpdate(station, targetDate, broadcastData);

        console.log(`Updated kqxs result: ${prizeType} = ${prizeData} for ${station}:${targetDate}:${tinh}`);
        res.status(200).json({ success: true, message: 'Cập nhật thành công' });
    } catch (error) {
        console.error('Error updating kqxs result:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    }
});

router.get('/stats', apiLimiter, async (req, res) => {
    try {
        const { station = 'xsmt', date } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        const subscribersCount = getLotterySubscribersCount(station, targetDate);

        res.status(200).json({
            station,
            date: targetDate,
            subscribersCount,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    }
});

// Endpoint mô phỏng quay số (cho testing)
router.post('/simulate', apiLimiter, async (req, res) => {
    try {
        const { station = 'xsmt', date, tinh } = req.body;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        const province = provincesByDay[new Date(parseDate(targetDate)).getDay()]?.[tinh];
        if (!province || !tinh) {
            return res.status(400).json({ error: 'Tỉnh không hợp lệ.' });
        }

        const mockData = {
            eightPrizes_0: '12',
            sevenPrizes_0: '840',
            sixPrizes_0: '4567',
            sixPrizes_1: '8901',
            sixPrizes_2: '2345',
            fivePrizes_0: '6789',
            fourPrizes_0: '1234',
            fourPrizes_1: '5678',
            fourPrizes_2: '9012',
            fourPrizes_3: '3456',
            fourPrizes_4: '7890',
            fourPrizes_5: '2345',
            fourPrizes_6: '6789',
            threePrizes_0: '0123',
            threePrizes_1: '4567',
            secondPrize_0: '89012',
            firstPrize_0: '34567',
            specialPrize_0: '12345',
            lastUpdated: Date.now(),
            drawDate: targetDate,
            station,
            tentinh: province.tentinh,
            tinh: province.tinh,
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
        };

        // Broadcast dữ liệu mô phỏng dạng mảng
        const broadcastData = [mockData];
        await broadcastLotteryUpdate(station, targetDate, broadcastData);

        console.log(`Simulated kqxs for ${station}:${targetDate}:${tinh}`);
        res.status(200).json({ success: true, message: 'Mô phỏng thành công' });
    } catch (error) {
        console.error('Error simulating kqxs:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    }
});

router.get('/check-and-broadcast', apiLimiter, async (req, res) => {
    try {
        const { station = 'xsmt', date } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const dayOfWeek = new Date(parseDate(targetDate)).getDay();
        const provinces = Object.keys(provincesByDay[dayOfWeek] || provincesByDay[6]);

        const data = await Promise.all(provinces.map(async (tinh) => {
            const redisKey = `kqxs:${station}:${targetDate}:${tinh}`;
            const existingData = await redisClient.hGetAll(redisKey);
            const latestData = await redisClient.get(`${redisKey}:latest`);
            const province = provincesByDay[dayOfWeek]?.[tinh] || provincesByDay[6]?.[tinh];
            let result = {
                drawDate: targetDate,
                station,
                tentinh: province.tentinh,
                tinh: province.tinh,
                year: new Date().getFullYear(),
                month: new Date().getMonth() + 1,
                dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
                lastUpdated: 0,
                eightPrizes_0: '...',
                sevenPrizes_0: '...',
                sixPrizes_0: '...',
                sixPrizes_1: '...',
                sixPrizes_2: '...',
                fivePrizes_0: '...',
                fourPrizes_0: '...',
                fourPrizes_1: '...',
                fourPrizes_2: '...',
                fourPrizes_3: '...',
                fourPrizes_4: '...',
                fourPrizes_5: '...',
                fourPrizes_6: '...',
                threePrizes_0: '...',
                threePrizes_1: '...',
                secondPrize_0: '...',
                firstPrize_0: '...',
                specialPrize_0: '...',
            };

            // Ưu tiên đọc từ existingData trước
            if (existingData && Object.keys(existingData).length > 0) {
                console.log(`Reading from existingData for ${redisKey}:`, existingData);
                for (const key of Object.keys(existingData)) {
                    if (result.hasOwnProperty(key)) {
                        try {
                            const parsedValue = JSON.parse(existingData[key]);
                            result[key] = parsedValue;
                        } catch (e) {
                            console.error(`Error parsing Redis data for ${redisKey}, key ${key}:`, e);
                            result[key] = existingData[key];
                        }
                    }
                }
            } else if (latestData) {
                // Nếu không có existingData, thử đọc từ latestData
                try {
                    const parsedLatest = JSON.parse(latestData);
                    console.log(`Reading from latestData for ${redisKey}:`, parsedLatest);
                    for (const key of Object.keys(parsedLatest)) {
                        if (result.hasOwnProperty(key)) {
                            result[key] = parsedLatest[key];
                        }
                    }
                    result.lastUpdated = parsedLatest.lastUpdated || Date.now();
                } catch (e) {
                    console.error(`Error parsing latestData for ${redisKey}:`, e);
                }
            }

            console.log(`Broadcast data for ${redisKey}:`, result);
            return result;
        }));

        // Broadcast dữ liệu dạng mảng
        await broadcastLotteryUpdate(station, targetDate, data);
        console.log(`Broadcasted LOTTERY_INITIAL for ${station}:${targetDate}:`, data);
        res.status(200).json({ success: true, message: 'Broadcasted initial data' });
    } catch (error) {
        console.error('Error checking and broadcasting:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

module.exports = router;