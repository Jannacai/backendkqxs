const express = require('express');
const router = express.Router();
const XSMB = require('../../models/XS_MB.models');
const { getLoGanStats, getSpecialPrizeStats, getDauDuoiStats, getDauDuoiStatsByDate, getSpecialPrizeStatsByWeek, getTanSuatLotoStats, getTanSuatLoCapStats } = require('../../controllers/xsmbController');
const { getBachThuMB } = require('../../controllers/soiCauMBController.js');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const cron = require('node-cron');

// bot telegram
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const bot = new TelegramBot(token);

// Kết nối Redis
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => console.error('Lỗi kết nối Redis:', err));

// Hàm hỗ trợ parse ngày
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

// Tính toán trước dữ liệu thống kê (chạy lúc 18:40 mỗi ngày)
cron.schedule('40 18 * * *', async () => {
    console.log('Tính toán trước thống kê lô gan...');
    const daysOptions = [6, 7, 14, 30, 60];
    for (const days of daysOptions) {
        const result = await getLoGanStats({ query: { days, station: 'xsmb' } }, { status: () => ({ json: () => { } }) });
        const cacheKey = `loGan:xsmb:${days}:all`;
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
    }

    console.log('Tính toán trước thống kê giải đặc biệt...');
    const specialDaysOptions = [10, 20, 30, 60, 90, 180, 270, 365];
    for (const days of specialDaysOptions) {
        const result = await getSpecialPrizeStats({ query: { days, station: 'xsmb' } }, { status: () => ({ json: () => { } }) });
        const cacheKey = `specialPrize:xsmb:${days}:all`;
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
    }

    console.log('Tính toán trước thống kê đầu đuôi...');
    const dauDuoiDaysOptions = [30, 60, 90, 120, 180, 365];
    for (const days of dauDuoiDaysOptions) {
        const result = await getDauDuoiStats({ query: { days } }, { status: () => ({ json: () => { } }) });
        const cacheKey = `dauDuoi:${days}:all`;
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
    }

    console.log('Tính toán trước thống kê đầu đuôi theo ngày...');
    for (const days of dauDuoiDaysOptions) {
        const result = await getDauDuoiStatsByDate({ query: { days } }, { status: () => ({ json: () => { } }) });
        const cacheKey = `dauDuoiByDate:${days}:all`;
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
    }
});

// Rate limiter
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
});

const statsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Quá nhiều yêu cầu thống kê, vui lòng thử lại sau',
    keyGenerator: (req) => {
        return req.headers['x-user-id'] || req.ip;
    },
});

const mapDayOfWeek = (dayOfWeekNoAccent) => {
    const dayMap = {
        'thu-2': 'Thứ 2',
        'thu-3': 'Thứ 3',
        'thu-4': 'Thứ 4',
        'thu-5': 'Thứ 5',
        'thu-6': 'Thứ 6',
        'thu-7': 'Thứ 7',
        'chu-nhat': 'Chủ nhật',
    };
    return dayMap[dayOfWeekNoAccent.toLowerCase()] || dayOfWeekNoAccent;
};

// Các route hiện có
router.get('/', apiLimiter, async (req, res) => {
    try {
        const { limit = 30 } = req.query;
        const cacheKey = `kqxs:all:${limit}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const results = await XSMB.find()
            .lean()
            .sort({ drawDate: -1 })
            .limit(parseInt(limit));

        if (!results.length) {
            return res.status(404).json({ error: 'Không tìm thấy dữ liệu KQXS' });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy tất cả KQXS:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau' });
    }
});

router.get('/xsmb', apiLimiter, async (req, res) => {
    try {
        const { date, limit = 30 } = req.query;
        const query = { station: 'xsmb' };
        if (date && /^\d{2}-\d{2}-\d{4}$/.test(date)) {
            query.drawDate = parseDate(date);
        }

        const results = await XSMB.find(query)
            .lean()
            .sort({ drawDate: -1 })
            .limit(parseInt(limit));

        if (!results.length) {
            return res.status(404).json({ error: `Không tìm thấy dữ liệu cho xsmb, date: ${date || 'all'}` });
        }

        const cacheKey = `kqxs:xsmb:${date || 'all'}:${limit}`;
        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy KQXS xsmb:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau' });
    }
});

router.get('/:slug', apiLimiter, async (req, res) => {
    const { slug } = req.params;
    try {
        if (!slug || slug.trim() === '') {
            return res.status(400).json({ error: 'Slug không được để trống' });
        }
        const cacheKey = `kqxs:slug:${slug}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await XSMB.findOne({ slug })
            .lean()
            .sort({ drawDate: -1 });
        if (!result) {
            return res.status(404).json({ error: 'Không tìm thấy kết quả' });
        }
        await redisClient.setEx(cacheKey, 60, JSON.stringify(result));
        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi khi lấy KQXS theo slug:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau' });
    }
});

router.get('/xsmb/:dayOfWeek', apiLimiter, async (req, res) => {
    const { dayOfWeek } = req.params;
    try {
        if (!dayOfWeek || dayOfWeek.trim() === '') {
            return res.status(400).json({ error: 'Thứ không được để trống' });
        }

        const cacheKey = `kqxs:day:${dayOfWeek}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const mappedDayOfWeek = mapDayOfWeek(dayOfWeek);
        const results = await XSMB.find({
            station: 'xsmb',
            dayOfWeek: mappedDayOfWeek,
        })
            .lean()
            .sort({ drawDate: -1 })
            .limit(30);
        if (!results || results.length === 0) {
            return res.status(404).json({ error: `Không tìm thấy kết quả cho ${mappedDayOfWeek}` });
        }
        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy KQXS theo thứ:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau' });
    }
});

// Danh sách KQXS theo tỉnh
router.get('/xsmb/tinh/:tinh', apiLimiter, async (req, res) => {
    const { tinh } = req.params;
    try {
        if (!tinh || tinh.trim() === '') {
            return res.status(400).json({ error: 'Tinh cannot be empty' });
        }

        const cacheKey = `kqxs:xsmb:tinh:${tinh}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await XSMB.find({ tinh }).lean()
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

// Route lấy kết quả xổ số trong khoảng thời gian
router.get('/xsmb/range', statsLimiter, async (req, res) => {
    try {
        const { startDate, endDate, limit = 30 } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Vui lòng cung cấp startDate và endDate.' });
        }

        const parsedStartDate = parseDate(startDate);
        const parsedEndDate = parseDate(endDate);
        if (parsedStartDate > parsedEndDate) {
            return res.status(400).json({ error: 'startDate phải nhỏ hơn hoặc bằng endDate.' });
        }

        const maxDays = 30;
        const diffDays = Math.ceil((parsedEndDate - parsedStartDate) / (1000 * 60 * 60 * 24));
        if (diffDays > maxDays) {
            return res.status(400).json({ error: `Khoảng thời gian không được vượt quá ${maxDays} ngày.` });
        }

        const cacheKey = `kqxs:range:xsmb:${startDate}:${endDate}:${limit}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const results = await XSMB.find({
            station: 'xsmb',
            drawDate: { $gte: parsedStartDate, $lte: parsedEndDate },
        })
            .lean()
            .sort({ drawDate: -1 })
            .limit(parseInt(limit));

        if (!results.length) {
            return res.status(404).json({ error: `Không tìm thấy dữ liệu XSMB từ ${startDate} đến ${endDate}.` });
        }

        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy KQXS trong khoảng thời gian:', error);
        if (error.message.includes('không hợp lệ')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
        }
    }
});

// Route lấy kết quả soi cầu bạch thủ trong khoảng thời gian
router.get('/xsmb/soicau/bach-thu/range', statsLimiter, async (req, res) => {
    try {
        const { startDate, endDate, days } = req.query;
        if (!startDate || !endDate || !days) {
            return res.status(400).json({ error: 'Vui lòng cung cấp startDate, endDate và days.' });
        }

        const validDays = [3, 5, 7, 10, 14];
        const numDays = parseInt(days);
        if (!validDays.includes(numDays)) {
            return res.status(400).json({ error: 'Số ngày không hợp lệ. Chỉ chấp nhận: 3, 5, 7, 10, 14.' });
        }

        const parsedStartDate = parseDate(startDate);
        const parsedEndDate = parseDate(endDate);
        if (parsedStartDate > parsedEndDate) {
            return res.status(400).json({ error: 'startDate phải nhỏ hơn hoặc bằng endDate.' });
        }

        const maxDays = 7;
        const diffDays = Math.ceil((parsedEndDate - parsedStartDate) / (1000 * 60 * 60 * 24));
        if (diffDays > maxDays) {
            return res.status(400).json({ error: `Khoảng thời gian không được vượt quá ${maxDays} ngày.` });
        }

        const cacheKey = `bachthu:range:${startDate}:${endDate}:days:${numDays}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const results = [];
        let currentDate = new Date(parsedStartDate);
        while (currentDate <= parsedEndDate) {
            const formattedDate = currentDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
            try {
                const reqMock = { query: { date: formattedDate, days: numDays } };
                const resMock = {
                    status: (code) => ({
                        json: (data) => {
                            if (code === 200) results.push(data);
                            else console.warn(`Không lấy được soi cầu cho ngày ${formattedDate}:`, data);
                        },
                    }),
                };
                await getBachThuMB(reqMock, resMock);
            } catch (err) {
                console.warn(`Lỗi khi lấy soi cầu cho ngày ${formattedDate}:`, err.message);
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        if (!results.length) {
            return res.status(404).json({ error: `Không tìm thấy dữ liệu soi cầu từ ${startDate} đến ${endDate}.` });
        }

        await redisClient.setEx(cacheKey, 86400, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy soi cầu bạch thủ trong khoảng thời gian:', error);
        if (error.message.includes('không hợp lệ')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
        }
    }
});

router.get('/xsmb/statistics/gan', statsLimiter, async (req, res) => {
    req.query.station = 'xsmb';
    await getLoGanStats(req, res);
});

router.get('/xsmb/statistics/special', statsLimiter, async (req, res) => {
    req.query.station = 'xsmb';
    await getSpecialPrizeStats(req, res);
});

router.get('/xsmb/statistics/dau-duoi', statsLimiter, async (req, res) => {
    req.query.station = 'xsmb';
    await getDauDuoiStats(req, res);
});

router.get('/xsmb/statistics/dau-duoi-by-date', statsLimiter, async (req, res) => {
    req.query.station = 'xsmb';
    await getDauDuoiStatsByDate(req, res);
});

router.get('/xsmb/statistics/special-by-week', statsLimiter, async (req, res) => {
    req.query.station = 'xsmb';
    await getSpecialPrizeStatsByWeek(req, res);
});

router.get('/xsmb/statistics/tan-suat-loto', statsLimiter, async (req, res) => {
    req.query.station = 'xsmb';
    await getTanSuatLotoStats(req, res);
});

router.get('/xsmb/statistics/tan-suat-lo-cap', statsLimiter, async (req, res) => {
    req.query.station = 'xsmb';
    await getTanSuatLoCapStats(req, res);
});

router.get('/xsmb/soicau/soi-cau-bach-thu', statsLimiter, async (req, res) => {
    await getBachThuMB(req, res);
});

router.post('/telegram', async (req, res) => {
    try {
        const update = req.body;
        if (!update.message) {
            return res.status(200).end();
        }

        const chatId = update.message.chat.id;
        const text = update.message.text;

        if (text === '/start') {
            await bot.sendMessage(chatId, 'Chào bạn! Gõ /xsmb để xem kết quả xổ số miền Bắc.');
        } else if (text === '/xsmb') {
            const response = await fetch('https://xsmb.win/xsmb', {
                headers: { 'x-user-id': 'bot' },
            });
            const data = await response.json();
            if (response.status !== 200) {
                await bot.sendMessage(chatId, 'Lỗi khi lấy kết quả XSMB.');
                return res.status(200).end();
            }

            const latestResult = data[0];
            const resultText = `Kết quả XSMB ngày ${latestResult.drawDate.toLocaleDateString('vi-VN')}:\n` +
                `Đặc biệt: ${latestResult.specialPrize_0 || 'Chưa có'}\n` +
                `Giải nhất: ${latestResult.firstPrize_0 || 'Chưa có'}`;
            await bot.sendMessage(chatId, resultText);
        } else {
            await bot.sendMessage(chatId, 'Lệnh không hợp lệ. Gõ /start hoặc /xsmb.');
        }

        return res.status(200).end();
    } catch (error) {
        console.error('Lỗi xử lý webhook Telegram:', error.message);
        return res.status(500).end();
    }
});

module.exports = router;