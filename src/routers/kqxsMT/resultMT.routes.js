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
redisClient.connect().catch(err => console.error('Lỗi kết nối Redis:', err));

// Tính toán trước dữ liệu thống kê (chạy lúc 0h mỗi ngày)
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
    thresholdTime.setHours(17, 35, 0, 0); // Đồng bộ với 17h35
    const targetDate = currentTime > thresholdTime ? moment(today, 'DD/MM/YYYY').add(1, 'days').format('DD/MM/YYYY') : today;
    const result = await getProvinces({ query: { date: targetDate } }, { status: () => ({ json: () => { } }) });
    const cacheKey = `provinces:${targetDate}`;
    await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
});

// Rate limiter cho SSE
const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
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
    keyGenerator: (req) => {
        return req.headers['x-user-id'] || req.ip;
    },
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
        thresholdTime.setHours(17, 35, 0, 0); // 17:35 threshold
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

        // Check MongoDB if schedule is empty
        if (provinces.length === 0) {
            const results = await XSMT.find({
                drawDate: moment(targetDate, 'DD/MM/YYYY').toDate(),
            }).distinct('tinh').lean();
            provinces = results.length > 0 ? results : ['Huế', 'Phú Yên']; // Fallback
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



// SSE cho XSMT
router.get('/xsmt/sse', sseLimiter, async (req, res) => {
    try {
        const { date, simulate, tinh } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const isSimulate = simulate === 'true';
        const province = tinh || 'hue';
        console.log('SSE target date:', targetDate, 'Simulate:', isSimulate, 'Tinh:', province);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'identity');
        res.flushHeaders();

        const provinces = {
            "hue": "Huế",
            "phu-yen": "Phú Yên",
            "dak-lak": "Đắk Lắk",
            "quang-nam": "Quảng Nam",
            "khanh-hoa": "Khánh Hòa",
            "da-nang": "Đà Nẵng",
            "binh-dinh": "Bình Định",
            "quang-tri": "Quảng Trị",
            "ninh-thuan": "Ninh Thuận",
            "gia-lai": "Gia Lai",
            "quang-ngai": "Quảng Ngãi",
            "dak-nong": "Đắk Nông",
            "kon-tum": "Kon Tum"
        };

        const tentinh = provinces[province] || 'Huế';

        const sendData = async (prizeType, prizeData, additionalData = {}) => {
            try {
                const data = {
                    [prizeType]: prizeData,
                    drawDate: targetDate,
                    tentinh: additionalData.tentinh || tentinh,
                    tinh: additionalData.tinh || province,
                    year: additionalData.year || new Date().getFullYear(),
                    month: additionalData.month || new Date().getMonth() + 1,
                };
                await redisClient.hSet(`kqxs:xsmt:${targetDate}:${province}`, prizeType, JSON.stringify(prizeData));
                await redisClient.hSet(`kqxs:xsmt:${targetDate}:${province}:meta`, 'metadata', JSON.stringify(additionalData));
                await redisClient.expire(`kqxs:xsmt:${targetDate}:${province}`, 7200);
                await redisClient.expire(`kqxs:xsmt:${targetDate}:${province}:meta`, 7200);
                res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
                res.flush();
                console.log(`Gửi SSE: ${prizeType} cho ngày ${targetDate}, tỉnh ${province}`);
            } catch (error) {
                console.error(`Lỗi gửi SSE (${prizeType}):`, error);
            }
        };

        const mockData = {
            eightPrizes: ['12'],
            sevenPrizes: ['123'],
            sixPrizes: ['1234', '5678', '9012'],
            fivePrizes: ['12345'],
            fourPrizes: ['12345', '67890', '23456', '78901', '34567', '89012', '45678'],
            threePrizes: ['12345', '67890'],
            secondPrize: ['12345'],
            firstPrize: ['12345'],
            specialPrize: ['123456']
        };

        const simulateLiveDraw = async (data) => {
            const prizeOrder = [
                { key: 'eightPrizes', delay: 1000 },
                { key: 'sevenPrizes', delay: 1000 },
                { key: 'sixPrizes', delay: 1000 },
                { key: 'fivePrizes', delay: 1000 },
                { key: 'fourPrizes', delay: 1000 },
                { key: 'threePrizes', delay: 1000 },
                { key: 'secondPrize', delay: 1000 },
                { key: 'firstPrize', delay: 1000 },
                { key: 'specialPrize', delay: 1000 }
            ];

            for (const { key, delay } of prizeOrder) {
                if (data[key]) {
                    await sendData(key, data[key], { tentinh, tinh: province, year: 2025, month: 5 });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        let existingData = await redisClient.hGetAll(`kqxs:xsmt:${targetDate}:${province}`);
        console.log('Dữ liệu Redis ban đầu:', existingData);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmt:${targetDate}:${province}:meta`, 'metadata')) || '{}');

        if (isSimulate) {
            const dataToUse = Object.keys(existingData).length > 0
                ? Object.fromEntries(Object.entries(existingData).map(([key, value]) => [key, JSON.parse(value)]))
                : mockData;
            await simulateLiveDraw(dataToUse);
            res.end();
            return;
        }

        const initialData = {
            eightPrizes: ['...'],
            sevenPrizes: ['...'],
            sixPrizes: ['...', '...', '...'],
            fivePrizes: ['...'],
            fourPrizes: ['...', '...', '...', '...', '...', '...', '...'],
            threePrizes: ['...', '...'],
            secondPrize: ['...'],
            firstPrize: ['...'],
            specialPrize: ['...']
        };

        for (const [prizeType, prizeData] of Object.entries(initialData)) {
            const cachedPrize = existingData[prizeType] ? JSON.parse(existingData[prizeType]) : prizeData;
            await sendData(prizeType, cachedPrize, metadata);
        }

        const subscriber = redis.createClient({ url: process.env.REDIS_URL });
        await subscriber.connect();
        await subscriber.subscribe(`xsmt:${targetDate}:${province}`, async (message) => {
            console.log('Nhận Redis message:', message);
            try {
                const { prizeType, prizeData, tentinh, tinh, year, month } = JSON.parse(message);
                if (prizeType && prizeData) {
                    await sendData(prizeType, prizeData, { tentinh, tinh, year, month });
                }
            } catch (error) {
                console.error('Lỗi xử lý Redis message:', error);
            }
        });

        const keepAlive = setInterval(() => {
            res.write(': keep-alive\n\n');
            res.flush();
        }, 15000);

        req.on('close', async () => {
            clearInterval(keepAlive);
            await subscriber.quit();
            res.end();
            console.log('Client ngắt kết nối SSE');
        });
    } catch (error) {
        console.error('Lỗi khi thiết lập SSE:', error);
        res.status(500).end();
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