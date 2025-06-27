const express = require('express');
const router = express.Router();
const XSMT = require('../../models/XS_MT.models');
const { getLoGanStats, getSpecialPrizeStats, getDauDuoiStats, getDauDuoiStatsByDate, getSpecialPrizeStatsByWeek, getTanSuatLotoStats, getTanSuatLoCapStats } = require('../../controllers/xsmbController');
const { getBachThuMT, getProvinces } = require('../../controllers/soiCauMTController');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const cron = require('node-cron');
const moment = require('moment');

// Kết nối Redis
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Hàm retry cho thao tác Redis
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

// Kết nối Redis với retry
const connectRedis = async () => {
    if (!redisClient.isOpen) {
        await retryOperation(() => redisClient.connect(), 3, 1000);
    }
};
connectRedis().catch(err => console.error('Lỗi kết nối Redis:', err));

// Tính toán trước dữ liệu thống kê (chạy lúc 17h40 mỗi ngày)
cron.schedule('40 17 * * *', async () => {
    console.log('Tính toán trước thống kê lô gan XSMT...');
    const daysOptions = [6, 7, 14, 30, 60];
    const provinces = ['hue', 'phu-yen', 'dak-lak', 'quang-nam', 'khanh-hoa', 'da-nang', 'binh-dinh', 'quang-tri', 'ninh-thuan', 'gia-lai', 'quang-ngai', 'dak-nong', 'kon-tum'];
    for (const tinh of provinces) {
        for (const days of daysOptions) {
            const result = await getLoGanStats({ query: { days, station: 'xsmt', tinh } }, { status: () => ({ json: () => { } }) });
            const cacheKey = `loGan:xsmt:${days}:${tinh}`;
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
        }
    }

    console.log('Tính toán trước thống kê giải đặc biệt XSMT...');
    const specialDaysOptions = [10, 20, 30, 60, 90, 180, 270, 365];
    for (const tinh of provinces) {
        for (const days of specialDaysOptions) {
            const result = await getSpecialPrizeStats({ query: { days, station: 'xsmt', tinh } }, { status: () => ({ json: () => { } }) });
            const cacheKey = `specialPrize:xsmt:${days}:${tinh}`;
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
        }
    }

    console.log('Tính toán trước thống kê đầu đuôi XSMT...');
    const dauDuoiDaysOptions = [30, 60, 90, 120, 180, 365];
    for (const tinh of provinces) {
        for (const days of dauDuoiDaysOptions) {
            const result = await getDauDuoiStats({ query: { days, station: 'xsmt', tinh } }, { status: () => ({ json: () => { } }) });
            const cacheKey = `dauDuoi:${days}:${tinh}`;
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
        }
    }

    console.log('Tính toán trước thống kê đầu đuôi theo ngày XSMT...');
    for (const tinh of provinces) {
        for (const days of dauDuoiDaysOptions) {
            const result = await getDauDuoiStatsByDate({ query: { days, station: 'xsmt', tinh } }, { status: () => ({ json: () => { } }) });
            const cacheKey = `dauDuoiByDate:${days}:${tinh}`;
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
        }
    }

    console.log('Tính toán trước danh sách tỉnh XSMT...');
    const today = moment().format('DD/MM/YYYY');
    const currentTime = new Date();
    const thresholdTime = new Date(currentTime);
    thresholdTime.setHours(17, 35, 0, 0);
    const targetDate = currentTime > thresholdTime ? moment(today, 'DD/MM/YYYY').add(1, 'days').format('DD/MM/YYYY') : today;
    const result = await getProvinces({ query: { date: targetDate } }, { status: () => ({ json: () => { } }) });
    const cacheKey = `provinces:${targetDate}`;
    await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
});

// Rate limiter cho SSE
const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: 'Quá nhiều yêu cầu SSE từ IP này, vui lòng thử lại sau.',
    keyGenerator: (req) => req.ip,
});

// Rate limiter cho các endpoint thông thường
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Quá nhiều yêu cầu API, vui lòng thử lại sau một phút.' },
});

// Rate limiter cho các endpoint thống kê
const statsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Quá nhiều yêu cầu thống kê, vui lòng thử lại sau một phút.' },
    keyGenerator: (req) => req.headers['x-user-id'] || req.ip,
});

// Hàm ánh xạ từ không dấu sang có dấu
const mapDayOfWeek = (dayOfWeekNoAccent) => {
    const dayMap = {
        'thu-2': 'Thứ 2',
        'thu-3': 'Thứ 3',
        'thu-4': 'Thứ 4',
        'thu-5': 'Thứ 5',
        'thu-6': 'Thứ 6',
        'thu-7': 'Thứ 7',
        'chu-nhat': 'Chủ nhật'
    };
    return dayMap[dayOfWeekNoAccent.toLowerCase()] || dayOfWeekNoAccent;
};

const provincesByDay = {
    0: { 'kon-tum': { tentinh: 'Kon Tum', tinh: 'kon-tum' }, 'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' }, 'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' } },
    1: { 'phu-yen': { tentinh: 'Phú Yên', tinh: 'phu-yen' }, 'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' } },
    2: { 'dak-lak': { tentinh: 'Đắk Lắk', tinh: 'dak-lak' }, 'quang-nam': { tentinh: 'Quảng Nam', tinh: 'quang-nam' } },
    3: { 'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' }, 'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' } },
    4: { 'binh-dinh': { tentinh: 'Bình Định', tinh: 'binh-dinh' }, 'quang-tri': { tentinh: 'Quảng Trị', tinh: 'quang-tri' }, 'quang-binh': { tentinh: 'Quảng Bình', tinh: 'quang-binh' } },
    5: { 'gia-lai': { tentinh: 'Gia Lai', tinh: 'gia-lai' }, 'ninh-thuan': { tentinh: 'Ninh Thuận', tinh: 'ninh-thuan' } },
    6: { 'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' }, 'quang-ngai': { tentinh: 'Quảng Ngãi', tinh: 'quang-ngai' }, 'dak-nong': { tentinh: 'Đắk Nông', tinh: 'dak-nong' } },
};

// Hàm kiểm tra thời gian khởi tạo initialData
const isInitialTime = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    return hours === 17 && minutes >= 10 && minutes < 15; // 17:10–17:15
};

// Endpoint lấy trạng thái ban đầu
router.get('/xsmt/sse/initial', apiLimiter, async (req, res) => {
    try {
        const { date, station, tinh } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const province = provincesByDay[new Date().getDay()]?.[tinh] || provincesByDay[6]?.[tinh];
        if (!province || !tinh) {
            return res.status(400).json({ error: 'Tỉnh không hợp lệ hoặc không được cung cấp.' });
        }

        // Lấy dữ liệu từ Redis
        let existingData = await redisClient.hGetAll(`kqxs:xsmt:${targetDate}:${tinh}`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmt:${targetDate}:${tinh}:meta`, 'metadata')) || '{}');

        // Khởi tạo initialData nếu chưa có hoặc tại thời điểm 17:10
        const initKey = `kqxs:xsmt:${targetDate}:${tinh}:init`;
        let initialData = await redisClient.get(initKey);
        if (!initialData && isInitialTime()) {
            initialData = {
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
                station: station || 'xsmt',
                tentinh: province.tentinh,
                tinh: province.tinh,
                year: new Date().getFullYear(),
                month: new Date().getMonth() + 1,
                dayOfWeek: new Date(targetDate.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
            };
            await redisClient.setEx(initKey, 86400, JSON.stringify(initialData));
        } else if (initialData) {
            initialData = JSON.parse(initialData);
        } else {
            initialData = {
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
                station: station || 'xsmt',
                tentinh: province.tentinh,
                tinh: province.tinh,
                year: new Date().getFullYear(),
                month: new Date().getMonth() + 1,
                dayOfWeek: new Date(targetDate.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
            };
        }

        // Cập nhật dữ liệu từ Redis nếu có
        for (const key of Object.keys(existingData)) {
            if (initialData[key]) {
                initialData[key] = JSON.parse(existingData[key]);
            }
        }

        res.status(200).json(initialData);
    } catch (error) {
        console.error('Lỗi khi lấy trạng thái ban đầu từ Redis:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    }
});

router.get('/xsmt/sse', sseLimiter, async (req, res) => {
    try {
        const { date, station, tinh, simulate } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const province = provincesByDay[new Date().getDay()]?.[tinh] || provincesByDay[6]?.[tinh];
        if (!province || !tinh) {
            return res.status(400).end('Tỉnh không hợp lệ hoặc không được cung cấp.');
        }
        const isSimulate = simulate === 'true';
        console.log('SSE XSMT:', { targetDate, station, tinh, isSimulate });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'identity');
        res.flushHeaders();

        const sendData = async (prizeType, prizeData, additionalData = {}) => {
            try {
                if (prizeData === '...') {
                    const currentData = await redisClient.hGet(`kqxs:xsmt:${targetDate}:${tinh}`, prizeType);
                    if (currentData && JSON.parse(currentData) !== '...') {
                        console.warn(`Bỏ qua ghi ${prizeType} = "..." vì đã có giá trị: ${currentData}`);
                        return;
                    }
                }
                const data = {
                    [prizeType]: prizeData,
                    drawDate: targetDate,
                    tentinh: additionalData.tentinh || province.tentinh,
                    tinh: additionalData.tinh || province.tinh,
                    year: additionalData.year || new Date().getFullYear(),
                    month: additionalData.month || new Date().getMonth() + 1,
                };
                await redisClient.hSet(`kqxs:xsmt:${targetDate}:${tinh}`, prizeType, JSON.stringify(prizeData));
                await redisClient.hSet(`kqxs:xsmt:${targetDate}:${tinh}:meta`, 'metadata', JSON.stringify(additionalData));
                await redisClient.expire(`kqxs:xsmt:${targetDate}:${tinh}`, 86400);
                await redisClient.expire(`kqxs:xsmt:${targetDate}:${tinh}:meta`, 86400);
                res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
                res.flush();
                console.log(`Gửi SSE XSMT: ${prizeType} cho tỉnh ${tinh}, ngày ${targetDate}`);
            } catch (error) {
                console.error(`Lỗi gửi SSE (${prizeType}):`, error);
            }
        };

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
        };

        const simulateLiveDraw = async (data) => {
            const prizeOrder = [
                { key: 'eightPrizes_0', delay: 500 },
                { key: 'sevenPrizes_0', delay: 500 },
                { key: 'sixPrizes_0', delay: 500 },
                { key: 'sixPrizes_1', delay: 500 },
                { key: 'sixPrizes_2', delay: 500 },
                { key: 'fivePrizes_0', delay: 500 },
                { key: 'fourPrizes_0', delay: 500 },
                { key: 'fourPrizes_1', delay: 500 },
                { key: 'fourPrizes_2', delay: 500 },
                { key: 'fourPrizes_3', delay: 500 },
                { key: 'fourPrizes_4', delay: 500 },
                { key: 'fourPrizes_5', delay: 500 },
                { key: 'fourPrizes_6', delay: 500 },
                { key: 'threePrizes_0', delay: 500 },
                { key: 'threePrizes_1', delay: 500 },
                { key: 'secondPrize_0', delay: 500 },
                { key: 'firstPrize_0', delay: 500 },
                { key: 'specialPrize_0', delay: 500 },
            ];
            for (const { key, delay } of prizeOrder) {
                if (data[key]) {
                    await sendData(key, data[key], { tentinh: province.tentinh, tinh: province.tinh, year: 2025, month: 6 });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        // Lấy dữ liệu thực tế từ Redis
        let existingData = await redisClient.hGetAll(`kqxs:xsmt:${targetDate}:${tinh}`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmt:${targetDate}:${tinh}:meta`, 'metadata')) || '{}');

        // Lấy hoặc tạo initialData
        const initKey = `kqxs:xsmt:${targetDate}:${tinh}:init`;
        let initialData = await redisClient.get(initKey);
        if (!initialData && isInitialTime()) {
            initialData = {
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
                station: station || 'xsmt',
                tentinh: province.tentinh,
                tinh: province.tinh,
                year: new Date().getFullYear(),
                month: new Date().getMonth() + 1,
                dayOfWeek: new Date(targetDate.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
            };
            await redisClient.setEx(initKey, 86400, JSON.stringify(initialData));
        } else if (initialData) {
            initialData = JSON.parse(initialData);
        } else {
            initialData = {
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
                station: station || 'xsmt',
                tentinh: province.tentinh,
                tinh: province.tinh,
                year: new Date().getFullYear(),
                month: new Date().getMonth() + 1,
                dayOfWeek: new Date(targetDate.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
            };
        }

        // Cập nhật initialData với dữ liệu thực tế từ Redis
        for (const key of Object.keys(existingData)) {
            if (initialData[key]) {
                initialData[key] = JSON.parse(existingData[key]);
            }
        }

        // Gửi dữ liệu ban đầu cho client
        const prizeTypes = [
            'eightPrizes_0', 'sevenPrizes_0',
            'sixPrizes_0', 'sixPrizes_1', 'sixPrizes_2',
            'fivePrizes_0',
            'fourPrizes_0', 'fourPrizes_1', 'fourPrizes_2', 'fourPrizes_3', 'fourPrizes_4', 'fourPrizes_5', 'fourPrizes_6',
            'threePrizes_0', 'threePrizes_1',
            'secondPrize_0', 'firstPrize_0', 'specialPrize_0'
        ];
        for (const prizeType of prizeTypes) {
            const prizeData = initialData[prizeType];
            await sendData(prizeType, prizeData, metadata);
        }

        if (isSimulate) {
            await simulateLiveDraw(mockData);
            res.end();
            return;
        }

        // Đăng ký nhận cập nhật từ Redis
        const subscriber = redis.createClient({ url: process.env.REDIS_URL });
        await subscriber.connect();
        await subscriber.subscribe(`xsmt:${targetDate}:${tinh}`, async (message) => {
            console.log('Nhận Redis message XSMT:', message);
            try {
                const { prizeType, prizeData, tentinh, tinh, year, month } = JSON.parse(message);
                if (prizeType && prizeData) {
                    await sendData(prizeType, prizeData, { tentinh, tinh, year, month });
                }
            } catch (error) {
                console.error('Lỗi xử lý Redis message XSMT:', error);
            }
        });

        const keepAlive = setInterval(() => {
            res.write(': keep-alive\n\n');
            res.flush();
        }, 5000);

        req.on('close', async () => {
            clearInterval(keepAlive);
            await subscriber.quit();
            res.end();
            console.log(`Client ngắt kết nối SSE XSMT cho tỉnh ${tinh}`);
        });
    } catch (error) {
        console.error('Lỗi khi thiết lập SSE XSMT:', error);
        res.status(500).end();
    }
});
// Danh sách KQXS (trả về tất cả, sắp xếp theo ngày mới nhất)
router.get('/xsmt', apiLimiter, async (req, res) => {
    try {
        const cacheKey = `kqxs:xsmt:all`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const results = await XSMT.find().lean()
            .sort({ drawDate: -1 });

        if (!results.length) {
            return res.status(404).json({ error: 'Result not found' });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Danh sách tỉnh XSMT theo ngày
router.get('/xsmt/provinces', apiLimiter, async (req, res) => {
    try {
        const { date } = req.query;
        if (!date || date.trim() === '') {
            return res.status(400).json({ error: 'Date cannot be empty' });
        }

        const currentTime = new Date();
        const thresholdTime = new Date(currentTime);
        thresholdTime.setHours(17, 35, 0, 0);
        const isAfterResultTime = currentTime > thresholdTime;
        const targetDate = isAfterResultTime ? moment(date, 'DD/MM/YYYY').add(1, 'days').format('DD/MM/YYYY') : date;

        const cacheKey = `provinces:${targetDate}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            console.log(`Trả về tỉnh từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const dayOfWeek = moment(targetDate, 'DD/MM/YYYY').format('dddd');
        const schedule = {
            'Monday': ['Huế', 'Phú Yên'],
            'Tuesday': ['Đắk Lắk', 'Quảng Nam'],
            'Wednesday': ['Đà Nẵng', 'Khánh Hòa'],
            'Thursday': ['Bình Định', 'Quảng Trị', 'Quảng Bình'],
            'Friday': ['Gia Lai', 'Ninh Thuận'],
            'Saturday': ['Đà Nẵng', 'Quảng Ngãi', 'Đắk Nông'],
            'Sunday': ['Kon Tum', 'Khánh Hòa', 'Thừa Thiên Huế'],
        };
        let provinces = schedule[dayOfWeek] || [];

        if (provinces.length === 0) {
            const results = await XSMT.find({
                drawDate: moment(targetDate, 'DD/MM/YYYY').toDate(),
            }).distinct('tinh').lean();
            provinces = results.length > 0 ? results : ['Huế', 'Phú Yên'];
            console.warn(`Danh sách tỉnh rỗng từ lịch, dùng dữ liệu MongoDB hoặc fallback: ${provinces}`);
        }

        await redisClient.setEx(cacheKey, 86400, JSON.stringify(provinces));
        console.log(`Đã cache danh sách tỉnh: ${cacheKey}, provinces: ${provinces}`);
        res.status(200).json(provinces);
    } catch (error) {
        console.error('Error in getProvinces route:', error.message);
        res.status(500).json({ error: `Không thể tải danh sách tỉnh: ${error.message}. Vui lòng thử lại hoặc chọn ngày khác. Gợi ý: ${moment().format('DD/MM/YYYY')}` });
    }
});

// Danh sách KQXS theo slug
router.get('/:slug', apiLimiter, async (req, res) => {
    const { slug } = req.params;
    try {
        if (!slug || slug.trim() === '') {
            return res.status(400).json({ error: 'Slug cannot be empty' });
        }

        const cacheKey = `kqxs:xsmt:slug:${slug}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await XSMT.findOne({ slug }).lean()
            .sort({ drawDate: -1 });

        if (!result) {
            return res.status(404).json({ error: 'Result not found' });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(result));
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Danh sách KQXS theo thứ
router.get('/xsmt/:dayOfWeek', apiLimiter, async (req, res) => {
    const { dayOfWeek } = req.params;
    try {
        if (!dayOfWeek || dayOfWeek.trim() === '') {
            return res.status(400).json({ error: 'dayOfWeek cannot be empty' });
        }

        const cacheKey = `kqxs:xsmt:day:${dayOfWeek}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const mappedDayOfWeek = mapDayOfWeek(dayOfWeek);
        console.log("Mapped dayOfWeek:", mappedDayOfWeek);
        const results = await XSMT.find({
            dayOfWeek: mappedDayOfWeek
        }).lean()
            .sort({ drawDate: -1 });

        console.log("Results:", results);
        if (!results || results.length === 0) {
            return res.status(404).json({ error: 'No results found for this day' });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Danh sách KQXS theo tỉnh
router.get('/xsmt/tinh/:tinh', apiLimiter, async (req, res) => {
    const { tinh } = req.params;
    try {
        if (!tinh || tinh.trim() === '') {
            return res.status(400).json({ error: 'Tinh cannot be empty' });
        }

        const cacheKey = `kqxs:xsmt:tinh:${tinh}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await XSMT.find({ tinh: tinh }).lean()
            .sort({ drawDate: -1 });

        if (!result || result.length === 0) {
            return res.status(404).json({ error: `Result not found for tinh: ${tinh}` });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(result));
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Thống kê lô gan
router.get('/xsmt/statistics/gan', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getLoGanStats(req, res);
});

// Thống kê giải đặc biệt
router.get('/xsmt/statistics/special', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getSpecialPrizeStats(req, res);
});

// Thống kê Đầu Đuôi
router.get('/xsmt/statistics/dau-duoi', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getDauDuoiStats(req, res);
});

// Thống kê Đầu Đuôi theo ngày
router.get('/xsmt/statistics/dau-duoi-by-date', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getDauDuoiStatsByDate(req, res);
});

router.get('/xsmt/statistics/special-by-week', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getSpecialPrizeStatsByWeek(req, res);
});

// Thống kê tần suất loto
router.get('/xsmt/statistics/tan-suat-loto', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getTanSuatLotoStats(req, res);
});

// Thống kê tần suất lô cặp
router.get('/xsmt/statistics/tan-suat-lo-cap', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getTanSuatLoCapStats(req, res);
});

// Soi cầu bạch thủ XSMT
router.get('/xsmt/soicau/soi-cau-bach-thu', apiLimiter, async (req, res) => {
    await getBachThuMT(req, res);
});

module.exports = router;