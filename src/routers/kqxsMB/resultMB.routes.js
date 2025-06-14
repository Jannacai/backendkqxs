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
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN'; // Dùng biến môi trường hoặc hardcode tạm
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

// Tính toán trước dữ liệu thống kê (chạy lúc 18:30 mỗi ngày)
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
const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 5000,
    message: 'Quá nhiều yêu cầu SSE từ IP này, vui lòng thử lại sau.',
    keyGenerator: (req) => req.ip,
});

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
router.get('/api/kqxs/xsmb/sse/initial', apiLimiter, async (req, res) => {
    try {
        const { date, station } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        // Lấy dữ liệu từ Redis
        let existingData = await redisClient.hGetAll(`kqxs:${targetDate}`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:${targetDate}:meta`, 'metadata')) || '{}');

        // Khởi tạo dữ liệu mặc định
        const initialData = {
            maDB: '...',
            specialPrize_0: '...',
            firstPrize_0: '...',
            secondPrize_0: '...',
            secondPrize_1: '...',
            threePrizes_0: '...',
            threePrizes_1: '...',
            threePrizes_2: '...',
            threePrizes_3: '...',
            threePrizes_4: '...',
            threePrizes_5: '...',
            fourPrizes_0: '...',
            fourPrizes_1: '...',
            fourPrizes_2: '...',
            fourPrizes_3: '...',
            fivePrizes_0: '...',
            fivePrizes_1: '...',
            fivePrizes_2: '...',
            fivePrizes_3: '...',
            fivePrizes_4: '...',
            fivePrizes_5: '...',
            sixPrizes_0: '...',
            sixPrizes_1: '...',
            sixPrizes_2: '...',
            sevenPrizes_0: '...',
            sevenPrizes_1: '...',
            sevenPrizes_2: '...',
            sevenPrizes_3: '...',
            drawDate: targetDate,
            station: station || 'xsmb',
            tentinh: metadata.tentinh || 'Miền Bắc',
            tinh: metadata.tinh || 'MB',
            year: metadata.year || new Date().getFullYear(),
            month: metadata.month || new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
        };

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
router.get('/xsmb/sse', sseLimiter, async (req, res) => {
    try {
        const { date, simulate, station } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const isSimulate = simulate === 'true';
        console.log('SSE target date:', targetDate, 'Simulate:', isSimulate);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'identity');
        res.flushHeaders();

        const sendData = async (prizeType, prizeData, additionalData = {}) => {
            try {
                const data = {
                    [prizeType]: prizeData,
                    drawDate: targetDate,
                    tentinh: additionalData.tentinh || 'Miền Bắc',
                    tinh: additionalData.tinh || 'MB',
                    year: additionalData.year || new Date().getFullYear(),
                    month: additionalData.month || new Date().getMonth() + 1,
                };
                await redisClient.hSet(`kqxs:${targetDate}`, prizeType, JSON.stringify(prizeData));
                await redisClient.hSet(`kqxs:${targetDate}:meta`, 'metadata', JSON.stringify(additionalData));
                await redisClient.expire(`kqxs:${targetDate}`, 7200);
                await redisClient.expire(`kqxs:${targetDate}:meta`, 7200);
                res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
                res.flush();
                console.log(`Gửi SSE: ${prizeType} cho ngày ${targetDate}`);
            } catch (error) {
                console.error(`Lỗi gửi SSE (${prizeType}):`, error);
            }
        };

        const mockData = {
            maDB: '1ER - 13ER - 10ER - 7ER - 4ER - 8ER',
            specialPrize_0: '12345',
            firstPrize_0: '67890',
            secondPrize_0: '11111',
            secondPrize_1: '22222',
            threePrizes_0: '33333',
            threePrizes_1: '44444',
            threePrizes_2: '55555',
            threePrizes_3: '66666',
            threePrizes_4: '77777',
            threePrizes_5: '88888',
            fourPrizes_0: '9999',
            fourPrizes_1: '0000',
            fourPrizes_2: '1234',
            fourPrizes_3: '5678',
            fivePrizes_0: '9012',
            fivePrizes_1: '3456',
            fivePrizes_2: '7890',
            fivePrizes_3: '2345',
            fivePrizes_4: '6789',
            fivePrizes_5: '0123',
            sixPrizes_0: '456',
            sixPrizes_1: '789',
            sixPrizes_2: '123',
            sevenPrizes_0: '12',
            sevenPrizes_1: '34',
            sevenPrizes_2: '56',
            sevenPrizes_3: '78',
        };

        const simulateLiveDraw = async (data) => {
            const prizeOrder = [
                { key: 'sevenPrizes_0', delay: 500 },
                { key: 'sevenPrizes_1', delay: 500 },
                { key: 'sevenPrizes_2', delay: 500 },
                { key: 'sevenPrizes_3', delay: 500 },
                { key: 'sixPrizes_0', delay: 500 },
                { key: 'sixPrizes_1', delay: 500 },
                { key: 'sixPrizes_2', delay: 500 },
                { key: 'fivePrizes_0', delay: 500 },
                { key: 'fivePrizes_1', delay: 500 },
                { key: 'fivePrizes_2', delay: 500 },
                { key: 'fivePrizes_3', delay: 500 },
                { key: 'fivePrizes_4', delay: 500 },
                { key: 'fivePrizes_5', delay: 500 },
                { key: 'fourPrizes_0', delay: 500 },
                { key: 'fourPrizes_1', delay: 500 },
                { key: 'fourPrizes_2', delay: 500 },
                { key: 'fourPrizes_3', delay: 500 },
                { key: 'threePrizes_0', delay: 500 },
                { key: 'threePrizes_1', delay: 500 },
                { key: 'threePrizes_2', delay: 500 },
                { key: 'threePrizes_3', delay: 500 },
                { key: 'threePrizes_4', delay: 500 },
                { key: 'threePrizes_5', delay: 500 },
                { key: 'secondPrize_0', delay: 500 },
                { key: 'secondPrize_1', delay: 500 },
                { key: 'firstPrize_0', delay: 500 },
                { key: 'specialPrize_0', delay: 500 },
                { key: 'maDB', delay: 500 },
            ];

            for (const { key, delay } of prizeOrder) {
                if (data[key]) {
                    await sendData(key, data[key], { tentinh: 'Miền Bắc', tinh: 'MB', year: 2025, month: 4 });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        const initialData = {
            maDB: '...',
            specialPrize_0: '...',
            firstPrize_0: '...',
            secondPrize_0: '...',
            secondPrize_1: '...',
            threePrizes_0: '...',
            threePrizes_1: '...',
            threePrizes_2: '...',
            threePrizes_3: '...',
            threePrizes_4: '...',
            threePrizes_5: '...',
            fourPrizes_0: '...',
            fourPrizes_1: '...',
            fourPrizes_2: '...',
            fourPrizes_3: '...',
            fivePrizes_0: '...',
            fivePrizes_1: '...',
            fivePrizes_2: '...',
            fivePrizes_3: '...',
            fivePrizes_4: '...',
            fivePrizes_5: '...',
            sixPrizes_0: '...',
            sixPrizes_1: '...',
            sixPrizes_2: '...',
            sevenPrizes_0: '...',
            sevenPrizes_1: '...',
            sevenPrizes_2: '...',
            sevenPrizes_3: '...',
        };

        let existingData = await redisClient.hGetAll(`kqxs:${targetDate}`);
        console.log('Dữ liệu Redis ban đầu:', existingData);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:${targetDate}:meta`, 'metadata')) || '{}');

        for (const key of Object.keys(initialData)) {
            if (existingData[key]) {
                initialData[key] = JSON.parse(existingData[key]);
            }
        }

        if (isSimulate) {
            await simulateLiveDraw(mockData);
            res.end();
            return;
        }

        for (const [prizeType, prizeData] of Object.entries(initialData)) {
            await sendData(prizeType, prizeData, metadata);
        }

        const subscriber = redis.createClient({ url: process.env.REDIS_URL });
        await subscriber.connect();
        await subscriber.subscribe(`xsmb:${targetDate}`, async (message) => {
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

        // Giới hạn khoảng thời gian tối đa 30 ngày để tránh tải nặng
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

        // Giới hạn khoảng thời gian tối đa 7 ngày để tối ưu hiệu suất
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
// Danh sách KQXS theo tỉnh (trả về bản ghi theo tỉnh)
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
            // Gọi API /xsmb
            const response = await fetch('http://localhost:3000/xsmb', {
                headers: { 'x-user-id': 'bot' }, // Thêm header để qua rate limiter
            });
            const data = await response.json();
            if (response.status !== 200) {
                await bot.sendMessage(chatId, 'Lỗi khi lấy kết quả XSMB.');
                return res.status(200).end();
            }

            // Lấy kết quả mới nhất
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