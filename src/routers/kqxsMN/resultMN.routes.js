const express = require('express');
const router = express.Router();
const XSMN = require('../../models/XS_MN.models');
const { getLoGanStats, getSpecialPrizeStats, getDauDuoiStats, getDauDuoiStatsByDate, getSpecialPrizeStatsByWeek, getTanSuatLotoStats, getTanSuatLoCapStats } = require('../../controllers/xsmbController');
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

// Danh sách tỉnh theo ngày
const provincesByDay = {
    0: {
        'tien-giang': { tentinh: 'Tiền Giang', tinh: 'tien-giang' },
        'kien-giang': { tentinh: 'Kiên Giang', tinh: 'kien-giang' },
        'da-lat': { tentinh: 'Đà Lạt', tinh: 'da-lat' }
    },
    1: {
        'tphcm': { tentinh: 'TP.HCM', tinh: 'tphcm' },
        'dong-thap': { tentinh: 'Đồng Tháp', tinh: 'dong-thap' },
        'ca-mau': { tentinh: 'Cà Mau', tinh: 'ca-mau' }
    },
    2: {
        'ben-tre': { tentinh: 'Bến Tre', tinh: 'ben-tre' },
        'vung-tau': { tentinh: 'Vũng Tàu', tinh: 'vung-tau' },
        'bac-lieu': { tentinh: 'Bạc Liêu', tinh: 'bac-lieu' }
    },
    3: {
        'dong-nai': { tentinh: 'Đồng Nai', tinh: 'dong-nai' },
        'can-tho': { tentinh: 'Cần Thơ', tinh: 'can-tho' },
        'soc-trang': { tentinh: 'Sóc Trăng', tinh: 'soc-trang' }
    },
    4: {
        'tay-ninh': { tentinh: 'Tây Ninh', tinh: 'tay-ninh' },
        'an-giang': { tentinh: 'An Giang', tinh: 'an-giang' },
        'binh-thuan': { tentinh: 'Bình Thuận', tinh: 'binh-thuan' }
    },
    5: {
        'vinh-long': { tentinh: 'Vĩnh Long', tinh: 'vinh-long' },
        'binh-duong': { tentinh: 'Bình Dương', tinh: 'binh-duong' },
        'tra-vinh': { tentinh: 'Trà Vinh', tinh: 'tra-vinh' }
    },
    6: {
        'tphcm': { tentinh: 'TP.HCM', tinh: 'tphcm' },
        'long-an': { tentinh: 'Long An', tinh: 'long-an' },
        'binh-phuoc': { tentinh: 'Bình Phước', tinh: 'binh-phuoc' },
        'hau-giang': { tentinh: 'Hậu Giang', tinh: 'hau-giang' }
    }
};

// Tính toán trước dữ liệu thống kê (chạy lúc 16h40 mỗi ngày)
cron.schedule('40 16 * * *', async () => {
    console.log('Tính toán trước thống kê lô gan XSMN...');
    const daysOptions = [6, 7, 14, 30, 60];
    const provinces = ['vung-tau', 'can-tho', 'dong-thap', 'tphcm', 'ca-mau', 'ben-tre', 'bac-lieu', 'soc-trang', 'dong-nai', 'an-giang', 'tay-ninh', 'binh-thuan', 'vinh-long', 'tra-vinh', 'long-an', 'binh-phuoc', 'hau-giang', 'kien-giang', 'tien-giang', 'da-lat'];
    for (const tinh of provinces) {
        for (const days of daysOptions) {
            const result = await getLoGanStats({ query: { days, station: 'xsmn', tinh } }, { status: () => ({ json: () => { } }) });
            const cacheKey = `loGan:xsmn:${days}:${tinh}`;
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
        }
    }

    console.log('Tính toán trước thống kê giải đặc biệt XSMN...');
    const specialDaysOptions = [10, 20, 30, 60, 90, 180, 270, 365];
    for (const tinh of provinces) {
        for (const days of specialDaysOptions) {
            const result = await getSpecialPrizeStats({ query: { days, station: 'xsmn', tinh } }, { status: () => ({ json: () => { } }) });
            const cacheKey = `specialPrize:xsmn:${days}:${tinh}`;
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
        }
    }

    console.log('Tính toán trước thống kê đầu đuôi XSMN...');
    const dauDuoiDaysOptions = [30, 60, 90, 120, 180, 365];
    for (const tinh of provinces) {
        for (const days of dauDuoiDaysOptions) {
            const result = await getDauDuoiStats({ query: { days, station: 'xsmn', tinh } }, { status: () => ({ json: () => { } }) });
            const cacheKey = `dauDuoi:${days}:${tinh}`;
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
        }
    }

    console.log('Tính toán trước thống kê đầu đuôi theo ngày XSMN...');
    for (const tinh of provinces) {
        for (const days of dauDuoiDaysOptions) {
            const result = await getDauDuoiStatsByDate({ query: { days, station: 'xsmn', tinh } }, { status: () => ({ json: () => { } }) });
            const cacheKey = `dauDuoiByDate:${days}:${tinh}`;
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
        }
    }
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
    keyGenerator: (req) => {
        return req.headers['x-user-id'] || req.ip;
    },
});

// Rate limiter cho SSE
const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: 'Quá nhiều yêu cầu SSE từ IP này, vui lòng thử lại sau.',
    keyGenerator: (req) => req.ip,
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

// Hàm kiểm tra thời gian khởi tạo initialData
const isInitialTime = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    return hours === 16 && minutes >= 10 && minutes < 15; // 16:10–16:15
};

// // Endpoint lấy trạng thái ban đầu
// router.get('/xsmn/sse/initial', apiLimiter, async (req, res) => {
//     try {
//         const { date, station, tinh } = req.query;
//         const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
//             ? date
//             : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
//         const province = provincesByDay[new Date().getDay()]?.[tinh] || provincesByDay[6]?.[tinh];
//         if (!province || !tinh) {
//             return res.status(400).json({ error: 'Tỉnh không hợp lệ hoặc không được cung cấp.' });
//         }

//         // Lấy dữ liệu từ Redis
//         let existingData = await redisClient.hGetAll(`kqxs:xsmn:${targetDate}:${tinh}`);
//         const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmn:${targetDate}:${tinh}:meta`, 'metadata')) || '{}');

//         // Khởi tạo initialData nếu chưa có hoặc tại thời điểm 16:10
//         const initKey = `kqxs:xsmn:${targetDate}:${tinh}:init`;
//         let initialData = await redisClient.get(initKey);
//         if (!initialData && isInitialTime()) {
//             initialData = {
//                 eightPrizes_0: '...',
//                 sevenPrizes_0: '...',
//                 sixPrizes_0: '...',
//                 sixPrizes_1: '...',
//                 sixPrizes_2: '...',
//                 fivePrizes_0: '...',
//                 fourPrizes_0: '...',
//                 fourPrizes_1: '...',
//                 fourPrizes_2: '...',
//                 fourPrizes_3: '...',
//                 fourPrizes_4: '...',
//                 fourPrizes_5: '...',
//                 fourPrizes_6: '...',
//                 threePrizes_0: '...',
//                 threePrizes_1: '...',
//                 secondPrize_0: '...',
//                 firstPrize_0: '...',
//                 specialPrize_0: '...',
//                 drawDate: targetDate,
//                 station: station || 'xsmn',
//                 tentinh: province.tentinh,
//                 tinh: province.tinh,
//                 year: new Date().getFullYear(),
//                 month: new Date().getMonth() + 1,
//                 dayOfWeek: new Date(targetDate.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
//             };
//             await redisClient.setEx(initKey, 86400, JSON.stringify(initialData));
//         } else if (initialData) {
//             initialData = JSON.parse(initialData);
//         } else {
//             initialData = {
//                 eightPrizes_0: '...',
//                 sevenPrizes_0: '...',
//                 sixPrizes_0: '...',
//                 sixPrizes_1: '...',
//                 sixPrizes_2: '...',
//                 fivePrizes_0: '...',
//                 fourPrizes_0: '...',
//                 fourPrizes_1: '...',
//                 fourPrizes_2: '...',
//                 fourPrizes_3: '...',
//                 fourPrizes_4: '...',
//                 fourPrizes_5: '...',
//                 fourPrizes_6: '...',
//                 threePrizes_0: '...',
//                 threePrizes_1: '...',
//                 secondPrize_0: '...',
//                 firstPrize_0: '...',
//                 specialPrize_0: '...',
//                 drawDate: targetDate,
//                 station: station || 'xsmn',
//                 tentinh: province.tentinh,
//                 tinh: province.tinh,
//                 year: new Date().getFullYear(),
//                 month: new Date().getMonth() + 1,
//                 dayOfWeek: new Date(targetDate.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
//             };
//         }

//         // Cập nhật dữ liệu từ Redis nếu có
//         for (const key of Object.keys(existingData)) {
//             if (initialData[key]) {
//                 initialData[key] = JSON.parse(existingData[key]);
//             }
//         }

//         res.status(200).json(initialData);
//     } catch (error) {
//         console.error('Lỗi khi lấy trạng thái ban đầu từ Redis:', error);
//         res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
//     }
// });

// // SSE cho XSMN
// router.get('/xsmn/sse', sseLimiter, async (req, res) => {
//     try {
//         const { date, station, tinh, simulate } = req.query;
//         const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
//             ? date
//             : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
//         const province = provincesByDay[new Date().getDay()]?.[tinh] || provincesByDay[6]?.[tinh];
//         if (!province || !tinh) {
//             return res.status(400).end('Tỉnh không hợp lệ hoặc không được cung cấp.');
//         }
//         const isSimulate = simulate === 'true';
//         console.log('SSE XSMN:', { targetDate, station, tinh, isSimulate });

//         res.setHeader('Content-Type', 'text/event-stream');
//         res.setHeader('Cache-Control', 'no-cache');
//         res.setHeader('Connection', 'keep-alive');
//         res.setHeader('Content-Encoding', 'identity');
//         res.flushHeaders();

//         const sendData = async (prizeType, prizeData, additionalData = {}) => {
//             try {
//                 if (prizeData === '...') {
//                     const currentData = await redisClient.hGet(`kqxs:xsmn:${targetDate}:${tinh}`, prizeType);
//                     if (currentData && JSON.parse(currentData) !== '...') {
//                         console.warn(`Bỏ qua ghi ${prizeType} = "..." vì đã có giá trị: ${currentData}`);
//                         return;
//                     }
//                 }
//                 const data = {
//                     [prizeType]: prizeData,
//                     drawDate: targetDate,
//                     tentinh: additionalData.tentinh || province.tentinh,
//                     tinh: additionalData.tinh || province.tinh,
//                     year: additionalData.year || new Date().getFullYear(),
//                     month: additionalData.month || new Date().getMonth() + 1,
//                 };
//                 await redisClient.hSet(`kqxs:xsmn:${targetDate}:${tinh}`, prizeType, JSON.stringify(prizeData));
//                 await redisClient.hSet(`kqxs:xsmn:${targetDate}:${tinh}:meta`, 'metadata', JSON.stringify(additionalData));
//                 await redisClient.expire(`kqxs:xsmn:${targetDate}:${tinh}`, 86400);
//                 await redisClient.expire(`kqxs:xsmn:${targetDate}:${tinh}:meta`, 86400);
//                 res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
//                 res.flush();
//                 console.log(`Gửi SSE XSMN: ${prizeType} cho tỉnh ${tinh}, ngày ${targetDate}`);
//             } catch (error) {
//                 console.error(`Lỗi gửi SSE (${prizeType}):`, error);
//             }
//         };

//         const mockData = {
//             eightPrizes_0: '12',
//             sevenPrizes_0: '840',
//             sixPrizes_0: '4567',
//             sixPrizes_1: '8901',
//             sixPrizes_2: '2345',
//             fivePrizes_0: '6789',
//             fourPrizes_0: '1234',
//             fourPrizes_1: '5678',
//             fourPrizes_2: '9012',
//             fourPrizes_3: '3456',
//             fourPrizes_4: '7890',
//             fourPrizes_5: '2345',
//             fourPrizes_6: '6789',
//             threePrizes_0: '0123',
//             threePrizes_1: '4567',
//             secondPrize_0: '89012',
//             firstPrize_0: '34567',
//             specialPrize_0: '12345',
//         };

//         const simulateLiveDraw = async (data) => {
//             const prizeOrder = [
//                 { key: 'eightPrizes_0', delay: 500 },
//                 { key: 'sevenPrizes_0', delay: 500 },
//                 { key: 'sixPrizes_0', delay: 500 },
//                 { key: 'sixPrizes_1', delay: 500 },
//                 { key: 'sixPrizes_2', delay: 500 },
//                 { key: 'fivePrizes_0', delay: 500 },
//                 { key: 'fourPrizes_0', delay: 500 },
//                 { key: 'fourPrizes_1', delay: 500 },
//                 { key: 'fourPrizes_2', delay: 500 },
//                 { key: 'fourPrizes_3', delay: 500 },
//                 { key: 'fourPrizes_4', delay: 500 },
//                 { key: 'fourPrizes_5', delay: 500 },
//                 { key: 'fourPrizes_6', delay: 500 },
//                 { key: 'threePrizes_0', delay: 500 },
//                 { key: 'threePrizes_1', delay: 500 },
//                 { key: 'secondPrize_0', delay: 500 },
//                 { key: 'firstPrize_0', delay: 500 },
//                 { key: 'specialPrize_0', delay: 500 },
//             ];
//             for (const { key, delay } of prizeOrder) {
//                 if (data[key]) {
//                     await sendData(key, data[key], { tentinh: province.tentinh, tinh: province.tinh, year: 2025, month: 6 });
//                     await new Promise(resolve => setTimeout(resolve, delay));
//                 }
//             }
//         };

//         // Lấy dữ liệu thực tế từ Redis
//         let existingData = await redisClient.hGetAll(`kqxs:xsmn:${targetDate}:${tinh}`);
//         const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmn:${targetDate}:${tinh}:meta`, 'metadata')) || '{}');

//         // Lấy hoặc tạo initialData
//         const initKey = `kqxs:xsmn:${targetDate}:${tinh}:init`;
//         let initialData = await redisClient.get(initKey);
//         if (!initialData && isInitialTime()) {
//             initialData = {
//                 eightPrizes_0: '...',
//                 sevenPrizes_0: '...',
//                 sixPrizes_0: '...',
//                 sixPrizes_1: '...',
//                 sixPrizes_2: '...',
//                 fivePrizes_0: '...',
//                 fourPrizes_0: '...',
//                 fourPrizes_1: '...',
//                 fourPrizes_2: '...',
//                 fourPrizes_3: '...',
//                 fourPrizes_4: '...',
//                 fourPrizes_5: '...',
//                 fourPrizes_6: '...',
//                 threePrizes_0: '...',
//                 threePrizes_1: '...',
//                 secondPrize_0: '...',
//                 firstPrize_0: '...',
//                 specialPrize_0: '...',
//                 drawDate: targetDate,
//                 station: station || 'xsmn',
//                 tentinh: province.tentinh,
//                 tinh: province.tinh,
//                 year: new Date().getFullYear(),
//                 month: new Date().getMonth() + 1,
//                 dayOfWeek: new Date(targetDate.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
//             };
//             await redisClient.setEx(initKey, 86400, JSON.stringify(initialData));
//         } else if (initialData) {
//             initialData = JSON.parse(initialData);
//         } else {
//             initialData = {
//                 eightPrizes_0: '...',
//                 sevenPrizes_0: '...',
//                 sixPrizes_0: '...',
//                 sixPrizes_1: '...',
//                 sixPrizes_2: '...',
//                 fivePrizes_0: '...',
//                 fourPrizes_0: '...',
//                 fourPrizes_1: '...',
//                 fourPrizes_2: '...',
//                 fourPrizes_3: '...',
//                 fourPrizes_4: '...',
//                 fourPrizes_5: '...',
//                 fourPrizes_6: '...',
//                 threePrizes_0: '...',
//                 threePrizes_1: '...',
//                 secondPrize_0: '...',
//                 firstPrize_0: '...',
//                 specialPrize_0: '...',
//                 drawDate: targetDate,
//                 station: station || 'xsmn',
//                 tentinh: province.tentinh,
//                 tinh: province.tinh,
//                 year: new Date().getFullYear(),
//                 month: new Date().getMonth() + 1,
//                 dayOfWeek: new Date(targetDate.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
//             };
//         }

//         // Cập nhật initialData với dữ liệu thực tế từ Redis
//         for (const key of Object.keys(existingData)) {
//             if (initialData[key]) {
//                 initialData[key] = JSON.parse(existingData[key]);
//             }
//         }

//         // Gửi dữ liệu ban đầu cho client
//         const prizeTypes = [
//             'eightPrizes_0', 'sevenPrizes_0',
//             'sixPrizes_0', 'sixPrizes_1', 'sixPrizes_2',
//             'fivePrizes_0',
//             'fourPrizes_0', 'fourPrizes_1', 'fourPrizes_2', 'fourPrizes_3', 'fourPrizes_4', 'fourPrizes_5', 'fourPrizes_6',
//             'threePrizes_0', 'threePrizes_1',
//             'secondPrize_0', 'firstPrize_0', 'specialPrize_0'
//         ];
//         for (const prizeType of prizeTypes) {
//             const prizeData = initialData[prizeType];
//             await sendData(prizeType, prizeData, metadata);
//         }

//         if (isSimulate) {
//             await simulateLiveDraw(mockData);
//             res.end();
//             return;
//         }

//         // Đăng ký nhận cập nhật từ Redis
//         const subscriber = redis.createClient({ url: process.env.REDIS_URL });
//         await subscriber.connect();
//         await subscriber.subscribe(`xsmn:${targetDate}:${tinh}`, async (message) => {
//             console.log('Nhận Redis message XSMN:', message);
//             try {
//                 const { prizeType, prizeData, tentinh, tinh, year, month } = JSON.parse(message);
//                 if (prizeType && prizeData) {
//                     await sendData(prizeType, prizeData, { tentinh, tinh, year, month });
//                 }
//             } catch (error) {
//                 console.error('Lỗi xử lý Redis message XSMN:', error);
//             }
//         });

//         const keepAlive = setInterval(() => {
//             res.write(': keep-alive\n\n');
//             res.flush();
//         }, 5000);

//         req.on('close', async () => {
//             clearInterval(keepAlive);
//             await subscriber.quit();
//             res.end();
//             console.log(`Client ngắt kết nối SSE XSMN cho tỉnh ${tinh}`);
//         });
//     } catch (error) {
//         console.error('Lỗi khi thiết lập SSE XSMN:', error);
//         res.status(500).end();
//     }
// });

// Danh sách KQXS (trả về tất cả, sắp xếp theo ngày mới nhất)
router.get('/xsmn', apiLimiter, async (req, res) => {
    try {
        const cacheKey = `kqxs:xsmn:all`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const results = await XSMN.find().lean()
            .sort({ drawDate: -1 });

        if (!results.length) {
            return res.status(404).json({ error: 'Không tìm thấy dữ liệu KQXS' });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi lấy danh sách KQXS:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Danh sách KQXS theo slug (trả về bản ghi mới nhất theo slug)
router.get('/:slug', apiLimiter, async (req, res) => {
    const { slug } = req.params;
    try {
        if (!slug || slug.trim() === '') {
            return res.status(400).json({ error: 'Slug cannot be empty' });
        }

        const cacheKey = `kqxs:xsmn:slug:${slug}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await XSMN.find({ slug }).lean()
            .sort({ drawDate: -1 });

        if (!result || result.length === 0) {
            return res.status(404).json({ error: 'Result not found' });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(result));
        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi lấy KQXS theo slug:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Danh sách KQXS theo thứ (dayOfWeek)
router.get('/xsmn/:dayOfWeek', apiLimiter, async (req, res) => {
    const { dayOfWeek } = req.params;
    try {
        if (!dayOfWeek || dayOfWeek.trim() === '') {
            return res.status(400).json({ error: 'dayOfWeek cannot be empty' });
        }

        const cacheKey = `kqxs:xsmn:day:${dayOfWeek}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const mappedDayOfWeek = mapDayOfWeek(dayOfWeek);
        console.log('Mapped dayOfWeek:', mappedDayOfWeek);
        const results = await XSMN.find({
            dayOfWeek: mappedDayOfWeek
        }).lean()
            .sort({ drawDate: -1 });

        console.log('Results:', results);
        if (!results || results.length === 0) {
            return res.status(404).json({ error: 'No results found for this day' });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi lấy KQXS theo dayOfWeek:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Danh sách KQXS theo tỉnh (trả về bản ghi theo tỉnh)
router.get('/xsmn/tinh/:tinh', apiLimiter, async (req, res) => {
    const { tinh } = req.params;
    try {
        if (!tinh || tinh.trim() === '') {
            return res.status(400).json({ error: 'Tinh cannot be empty' });
        }

        const cacheKey = `kqxs:xsmn:tinh:${tinh}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await XSMN.find({ tinh }).lean()
            .sort({ drawDate: -1 });

        if (!result || result.length === 0) {
            return res.status(404).json({ error: 'Result not found' });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(result));
        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi lấy KQXS theo tỉnh:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Thống kê lô gan
router.get('/xsmn/statistics/gan', statsLimiter, async (req, res) => {
    req.query.station = 'xsmn';
    await getLoGanStats(req, res);
});

// Thống kê giải đặc biệt
router.get('/xsmn/statistics/special', statsLimiter, async (req, res) => {
    req.query.station = 'xsmn';
    await getSpecialPrizeStats(req, res);
});

// Thống kê Đầu Đuôi
router.get('/xsmn/statistics/dau-duoi', statsLimiter, async (req, res) => {
    req.query.station = 'xsmn';
    await getDauDuoiStats(req, res);
});

// Thống kê Đầu Đuôi theo ngày
router.get('/xsmn/statistics/dau-duoi-by-date', statsLimiter, async (req, res) => {
    req.query.station = 'xsmn';
    await getDauDuoiStatsByDate(req, res);
});

router.get('/xsmn/statistics/special-by-week', statsLimiter, async (req, res) => {
    req.query.station = 'xsmn';
    await getSpecialPrizeStatsByWeek(req, res);
});

// Thống kê tần suất loto
router.get('/xsmn/statistics/tan-suat-loto', statsLimiter, async (req, res) => {
    req.query.station = 'xsmn';
    await getTanSuatLotoStats(req, res);
});

// Thống kê tần suất lô cặp
router.get('/xsmn/statistics/tan-suat-lo-cap', statsLimiter, async (req, res) => {
    req.query.station = 'xsmn';
    await getTanSuatLoCapStats(req, res);
});

module.exports = router;