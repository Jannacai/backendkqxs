const express = require('express');
const router = express.Router();
const XSMT = require('../../models/XS_MT.models');
const { getLoGanStats, getSpecialPrizeStats, getDauDuoiStats, getDauDuoiStatsByDate, getSpecialPrizeStatsByWeek, getTanSuatLotoStats, getTanSuatLoCapStats } = require('../../controllers/xsmbController.js');
const { getBachThuMT } = require('../../controllers/soiCauMTController.js');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const cron = require('node-cron');

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

// Tính toán trước dữ liệu thống kê (chạy lúc 17:30 mỗi ngày)
cron.schedule('34 17 * * *', async () => {
    console.log('Tính toán trước thống kê lô gan...');
    const daysOptions = [6, 7, 14, 30, 60];
    for (const days of daysOptions) {
        const result = await getLoGanStats({ query: { days, station: 'xsmt' } }, { status: () => ({ json: () => { } }) });
        const cacheKey = `loGan:xsmt:${days}:all`;
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(result));
    }

    console.log('Tính toán trước thống kê giải đặc biệt...');
    const specialDaysOptions = [10, 20, 30, 60, 90, 180, 270, 365];
    for (const days of specialDaysOptions) {
        const result = await getSpecialPrizeStats({ query: { days, station: 'xsmt' } }, { status: () => ({ json: () => { } }) });
        const cacheKey = `specialPrize:xsmt:${days}:all`;
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

router.get('/xsmt/sse', sseLimiter, async (req, res) => {
    try {
        const { date, simulate, tinh } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const province = tinh || 'hue';
        const isSimulate = simulate === 'true';
        console.log('SSE target date:', targetDate, 'Province:', province, 'Simulate:', isSimulate);

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
                    tentinh: additionalData.tentinh || 'Huế',
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
            eightPrizes_0: '12',
            sevenPrizes_0: '123',
            sixPrizes_0: '1234',
            sixPrizes_1: '5678',
            sixPrizes_2: '9012',
            fivePrizes_0: '3456',
            fourPrizes_0: '7890',
            fourPrizes_1: '2345',
            fourPrizes_2: '6789',
            fourPrizes_3: '0123',
            fourPrizes_4: '4567',
            fourPrizes_5: '8901',
            fourPrizes_6: '2345',
            threePrizes_0: '67890',
            threePrizes_1: '12345',
            secondPrize_0: '67890',
            firstPrize_0: '12345',
            specialPrize_0: '123456',
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
                    await sendData(key, data[key], { tentinh: 'Huế', tinh: province, year: 2025, month: 4 });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

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
        };

        let existingData = await redisClient.hGetAll(`kqxs:xsmt:${targetDate}:${province}`);
        console.log('Dữ liệu Redis ban đầu từ Redis...:', existingData);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmt:${targetDate}:${province}:meta`, 'metadata')) || '{}');

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
        await subscriber.subscribe(`xsmt:${targetDate}:${province}`, async (message) => {
            console.log('Nhận Redis message:', message);
            try {
                const { prizeType, prizeData, tentinh, tinh, year, month } = JSON.parse(message);
                if (prizeType && prizeData && prizeType.includes('_')) {
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

router.get('/api/kqxs/xsmt/sse/initial', apiLimiter, async (req, res) => {
    try {
        const { date, station, tinh } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const province = tinh || 'hue';

        // Lấy dữ liệu từ Redis
        let existingData = await redisClient.hGetAll(`kqxs:xsmt:${targetDate}:${province}`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmt:${targetDate}:${province}:meta`, 'metadata')) || '{}');

        // Khởi tạo dữ liệu mặc định
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
            station: station || 'xsmt',
            tentinh: metadata.tentinh || 'Huế',
            tinh: metadata.tinh || province,
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

// Route lấy kết quả xổ số trong khoảng thời gian
router.get('/xsmt/range', statsLimiter, async (req, res) => {
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

        const cacheKey = `kqxs:range:xsmt:${startDate}:${endDate}:${limit}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return res.status(200).json(JSON.parse(cached));
        }

        const results = await XSMT.find({
            station: 'xsmt',
            drawDate: { $gte: parsedStartDate, $lte: parsedEndDate },
        })
            .lean()
            .sort({ drawDate: -1 })
            .limit(parseInt(limit));

        if (!results.length) {
            return res.status(404).json({ error: `Không tìm thấy dữ liệu XSMT từ ${startDate} đến ${endDate}.` });
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
router.get('/xsmt/soicau/bach-thu/range', statsLimiter, async (req, res) => {
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
                await getBachThuMT(reqMock, resMock);
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

        const results = await XSMT.find()
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

router.get('/xsmt', apiLimiter, async (req, res) => {
    try {
        const { date, limit = 30 } = req.query;
        const query = { station: 'xsmt' };
        if (date && /^\d{2}-\d{2}-\d{4}$/.test(date)) {
            query.drawDate = parseDate(date);
        }

        const results = await XSMT.find(query)
            .lean()
            .sort({ drawDate: -1 })
            .limit(parseInt(limit));

        if (!results.length) {
            return res.status(404).json({ error: `Không tìm thấy dữ liệu cho xsmt, date: ${date || 'all'}` });
        }

        const cacheKey = `kqxs:xsmt:${date || 'all'}:${limit}`;
        await redisClient.setEx(cacheKey, 60, JSON.stringify(results));
        res.status(200).json(results);
    } catch (error) {
        console.error('Lỗi khi lấy KQXS xsmt:', error);
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

        const result = await XSMT.findOne({ slug })
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

router.get('/xsmt/:dayOfWeek', apiLimiter, async (req, res) => {
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
        const results = await XSMT.find({
            station: 'xsmt',
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

        const result = await XSMT.find({ tinh }).lean()
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

router.get('/xsmt/statistics/gan', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getLoGanStats(req, res);
});

router.get('/xsmt/statistics/special', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getSpecialPrizeStats(req, res);
});

router.get('/xsmt/statistics/dau-duoi', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getDauDuoiStats(req, res);
});

router.get('/xsmt/statistics/dau-duoi-by-date', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getDauDuoiStatsByDate(req, res);
});

router.get('/xsmt/statistics/special-by-week', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getSpecialPrizeStatsByWeek(req, res);
});

router.get('/xsmt/statistics/tan-suat-loto', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getTanSuatLotoStats(req, res);
});

router.get('/xsmt/statistics/tan-suat-lo-cap', statsLimiter, async (req, res) => {
    req.query.station = 'xsmt';
    await getTanSuatLoCapStats(req, res);
});

router.get('/xsmt/soicau/soi-cau-bach-thu', statsLimiter, async (req, res) => {
    await getBachThuMT(req, res);
});

module.exports = router;