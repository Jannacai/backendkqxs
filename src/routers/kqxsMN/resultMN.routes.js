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


// Danh sách KQXS (trả về tất cả, sắp xếp theo ngày mới nhất)
router.get('/xsmn', apiLimiter, async (req, res) => {
    try {
        const { forceRefresh, liveWindow, page = 1, limit = 3, daysPerPage = 3 } = req.query;
        const now = new Date();
        const vietnamTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const vietnamHours = vietnamTime.getHours();
        const vietnamMinutes = vietnamTime.getMinutes();
        const isLiveWindow = vietnamHours === 16 && vietnamMinutes >= 10 && vietnamMinutes <= 59;
        const isPostLiveWindow = vietnamHours > 16 || (vietnamHours === 16 && vietnamMinutes > 59);

        // Cache key với page và daysPerPage
        const cacheKey = `kqxs:xsmn:page:${page}:daysPerPage:${daysPerPage}:${isLiveWindow ? 'live' : 'normal'}`;
        const cached = await redisClient.get(cacheKey);

        // Logic cache invalidation thông minh
        const shouldUseCache = cached && !forceRefresh && !liveWindow;
        const cacheDuration = isLiveWindow ? 60 : 300; // 1 phút cho live, 5 phút cho normal

        if (shouldUseCache) {
            console.log(`📦 Trả về cached data: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        console.log(`🔄 Fetching fresh data từ MongoDB: ${cacheKey}, page: ${page}, daysPerPage: ${daysPerPage}`);

        // Lấy tất cả unique dates để tính toán pagination theo ngày
        const allDates = await XSMN.find().lean()
            .sort({ drawDate: -1 })
            .distinct('drawDate');

        // Sắp xếp lại dates theo thứ tự mới nhất (vì distinct có thể không giữ thứ tự)
        const sortedDates = allDates.sort((a, b) => new Date(b) - new Date(a));

        // Tính toán skip cho pagination theo ngày
        const skipDays = (parseInt(page) - 1) * parseInt(daysPerPage);
        const targetDates = sortedDates.slice(skipDays, skipDays + parseInt(daysPerPage));

        console.log(`📊 Pagination debug:`, {
            totalDates: sortedDates.length,
            page: parseInt(page),
            daysPerPage: parseInt(daysPerPage),
            skipDays,
            targetDates: targetDates.map(d => new Date(d).toLocaleDateString('vi-VN')),
            firstDate: sortedDates[0] ? new Date(sortedDates[0]).toLocaleDateString('vi-VN') : 'N/A',
            lastDate: sortedDates[sortedDates.length - 1] ? new Date(sortedDates[sortedDates.length - 1]).toLocaleDateString('vi-VN') : 'N/A'
        });

        if (targetDates.length === 0) {
            return res.status(404).json({ error: 'Result not found' });
        }

        // Lấy tất cả records cho các ngày được chọn
        const results = await XSMN.find({
            drawDate: { $in: targetDates }
        }).lean()
            .sort({ drawDate: -1, tentinh: 1 });

        // Cache với duration phù hợp
        await redisClient.setEx(cacheKey, cacheDuration, JSON.stringify(results));
        console.log(`✅ Đã cache data: ${cacheKey}, duration: ${cacheDuration}s, results: ${results.length}, dates: ${targetDates.length}`);

        res.status(200).json(results);
    } catch (error) {
        console.error('❌ Lỗi fetch XSMN data:', error);
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