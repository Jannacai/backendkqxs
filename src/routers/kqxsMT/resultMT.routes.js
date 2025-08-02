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

// BỔ SUNG: Helper function để lấy thời gian Việt Nam và kiểm tra 17h35
const getVietnamTime = () => {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
};
const isAfter1735 = () => {
    const vietnamTime = getVietnamTime();
    return vietnamTime.getHours() === 17 && vietnamTime.getMinutes() >= 35;
};

// Tính toán trước dữ liệu thống kê và xóa cache (chạy lúc 17h35 mỗi ngày - ĐỒNG BỘ VỚI FRONTEND)
cron.schedule('35 17 * * *', async () => {
    console.log('🕐 17h35 - Bắt đầu xóa cache và tính toán thống kê...');
    try {
        const today = new Date().toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }).replace(/\//g, '-');
        const cacheKeysToDelete = [
            `kqxs:xsmt:${today}:30:1`,
            `kqxs:xsmt:modal:latest`,
            `kqxs:xsmt:all:30`,
            `kqxs:all:30`
        ];
        for (const key of cacheKeysToDelete) {
            await redisClient.del(key);
            console.log(`🗑️ Đã xóa cache: ${key}`);
        }
        console.log('✅ Đã xóa cache XSMT để frontend lấy dữ liệu mới');
    } catch (error) {
        console.error('❌ Lỗi khi xóa cache:', error);
    }
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

// Danh sách KQXS (trả về tất cả, sắp xếp theo ngày mới nhất)
router.get('/xsmt', apiLimiter, async (req, res) => {
    try {
        const { forceRefresh, liveWindow, page = 1, limit = 3, daysPerPage = 3 } = req.query;
        const now = new Date();
        const vietnamTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
        const vietnamHours = vietnamTime.getHours();
        const vietnamMinutes = vietnamTime.getMinutes();
        const isLiveWindow = vietnamHours === 17 && vietnamMinutes >= 10 && vietnamMinutes <= 59;
        const isPostLiveWindow = vietnamHours > 17 || (vietnamHours === 17 && vietnamMinutes > 59);

        // Cache key với page và daysPerPage
        const cacheKey = `kqxs:xsmt:page:${page}:daysPerPage:${daysPerPage}:${isLiveWindow ? 'live' : 'normal'}`;
        const cached = await redisClient.get(cacheKey);

        // Logic cache invalidation thông minh
        const shouldForceRefresh = isAfter1735(); // Use helper
        const shouldUseCache = cached && !forceRefresh && !liveWindow && !shouldForceRefresh;
        const cacheDuration = isLiveWindow ? 60 : 300; // 1 phút cho live, 5 phút cho normal

        if (shouldUseCache) {
            console.log(`📦 Trả về cached data: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        console.log(`🔄 Fetching fresh data từ MongoDB: ${cacheKey}, page: ${page}, daysPerPage: ${daysPerPage}${shouldForceRefresh ? ' (sau 17h35)' : ''}`);

        // Lấy tất cả unique dates để tính toán pagination theo ngày
        const allDates = await XSMT.find().lean()
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
        const results = await XSMT.find({
            drawDate: { $in: targetDates }
        }).lean()
            .sort({ drawDate: -1, tentinh: 1 });

        // Cache với duration phù hợp
        await redisClient.setEx(cacheKey, cacheDuration, JSON.stringify(results));
        console.log(`✅ Đã cache data: ${cacheKey}, duration: ${cacheDuration}s, results: ${results.length}, dates: ${targetDates.length}`);

        res.status(200).json(results);
    } catch (error) {
        console.error('❌ Lỗi fetch XSMT data:', error);
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
        const shouldForceRefresh = isAfter1735(); // Use helper
        if (cached && !shouldForceRefresh) {
            console.log(`📦 Cache hit cho provinces: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }
        console.log(`🔄 Fetching fresh provinces data: ${cacheKey}${shouldForceRefresh ? ' (sau 17h35)' : ''}`);

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

// Invalidate cache khi có data mới (được gọi từ scraper)
router.post('/xsmt/invalidate-cache', async (req, res) => {
    try {
        const { date, tinh } = req.body;
        const cacheKeys = [
            'kqxs:xsmt:page:*', // Xóa tất cả page cache
            'kqxs:xsmt:all:live',
            'kqxs:xsmt:all:normal',
            `kqxs:xsmt:day:*`,
            `kqxs:xsmt:tinh:*`
        ];

        // Xóa tất cả cache liên quan
        for (const pattern of cacheKeys) {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
                console.log(`🧹 Đã xóa ${keys.length} cache keys với pattern: ${pattern}`);
            }
        }

        console.log(`✅ Đã invalidate cache cho date: ${date}, tinh: ${tinh}`);
        res.status(200).json({ message: 'Cache invalidated successfully' });
    } catch (error) {
        console.error('❌ Lỗi invalidate cache:', error);
        res.status(500).json({ error: 'Failed to invalidate cache' });
    }
});

// Health check endpoint
router.get('/xsmt/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        cache: 'active'
    });
});

// Debug endpoint để kiểm tra dữ liệu
router.get('/xsmt/debug', async (req, res) => {
    try {
        const allDates = await XSMT.find().lean()
            .sort({ drawDate: -1 })
            .distinct('drawDate');

        const sortedDates = allDates.sort((a, b) => new Date(b) - new Date(a));

        const latestRecords = await XSMT.find().lean()
            .sort({ drawDate: -1 })
            .limit(10);

        res.status(200).json({
            totalDates: sortedDates.length,
            latestDates: sortedDates.slice(0, 10).map(d => new Date(d).toLocaleDateString('vi-VN')),
            latestRecords: latestRecords.map(r => ({
                drawDate: new Date(r.drawDate).toLocaleDateString('vi-VN'),
                tentinh: r.tentinh,
                tinh: r.tinh
            })),
            currentTime: new Date().toLocaleDateString('vi-VN')
        });
    } catch (error) {
        console.error('❌ Lỗi debug endpoint:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;