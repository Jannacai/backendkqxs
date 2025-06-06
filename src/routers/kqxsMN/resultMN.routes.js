const express = require('express');
const router = express.Router();
const XSMN = require('../../models/XS_MN.models');
const { getLoGanStats, getSpecialPrizeStats, getDauDuoiStats, getDauDuoiStatsByDate, getSpecialPrizeStatsByWeek, getTanSuatLotoStats, getTanSuatLoCapStats } = require('../../controllers/xsmbController');
const rateLimit = require('express-rate-limit');
const redis = require('redis');
const cron = require('node-cron');

// Kết nối Redis
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => console.error('Lỗi kết nối Redis:', err));

// Map lưu trữ subscriber và danh sách client SSE cho mỗi kênh
const subscribers = new Map(); // channel -> { subscriber, clients: Set }

// Tính toán trước dữ liệu thống kê (chạy lúc 0h mỗi ngày)
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

// SSE cho XSMN
router.get('/xsmn/sse', sseLimiter, async (req, res) => {
    try {
        const { date, simulate, tinh } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
        const isSimulate = simulate === 'true';
        const province = tinh || 'vung-tau';
        const redisKey = `kqxs:xsmn:${targetDate}:${province}`;
        const channel = `xsmn:${targetDate}:${province}`;

        console.log(`SSE request: date=${targetDate}, simulate=${isSimulate}, tinh=${province}, redisKey=${redisKey}`);

        // Thiết lập header cho SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'identity');
        res.flushHeaders();

        const provinces = {
            'vung-tau': 'Vũng Tàu',
            'can-tho': 'Cần Thơ',
            'dong-thap': 'Đồng Tháp',
            'tphcm': 'TP.HCM',
            'ca-mau': 'Cà Mau',
            'ben-tre': 'Bến Tre',
            'bac-lieu': 'Bạc Liêu',
            'soc-trang': 'Sóc Trăng',
            'dong-nai': 'Đồng Nai',
            'an-giang': 'An Giang',
            'tay-ninh': 'Tây Ninh',
            'binh-thuan': 'Bình Thuận',
            'vinh-long': 'Vĩnh Long',
            'tra-vinh': 'Trà Vinh',
            'long-an': 'Long An',
            'binh-phuoc': 'Bình Phước',
            'hau-giang': 'Hậu Giang',
            'kien-giang': 'Kiên Giang',
            'tien-giang': 'Tiền Giang',
            'da-lat': 'Đà Lạt'
        };

        const tentinh = provinces[province] || province;

        const sendData = async (type, data) => {
            try {
                res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
                res.flush();
                console.log(`Gửi SSE: type=${type}, province=${province}, date=${targetDate}`, data);
            } catch (error) {
                console.error(`Lỗi gửi SSE (${type}):`, error.message);
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
                    await sendData('update', { [key]: data[key], tentinh, tinh: province, drawDate: targetDate });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        const existingData = await redisClient.hGetAll(redisKey);
        console.log('Dữ liệu Redis ban đầu:', Object.keys(existingData));
        const metadata = JSON.parse(existingData.metadata || '{}');

        const initialData = {
            eightPrizes: JSON.parse(existingData.eightPrizes_0 || '["..."]'),
            sevenPrizes: JSON.parse(existingData.sevenPrizes_0 || '["..."]'),
            sixPrizes: [
                JSON.parse(existingData.sixPrizes_0 || '"..."'),
                JSON.parse(existingData.sixPrizes_1 || '"..."'),
                JSON.parse(existingData.sixPrizes_2 || '"..."')
            ],
            fivePrizes: JSON.parse(existingData.fivePrizes_0 || '["..."]'),
            fourPrizes: [
                JSON.parse(existingData.fourPrizes_0 || '"..."'),
                JSON.parse(existingData.fourPrizes_1 || '"..."'),
                JSON.parse(existingData.fourPrizes_2 || '"..."'),
                JSON.parse(existingData.fourPrizes_3 || '"..."'),
                JSON.parse(existingData.fourPrizes_4 || '"..."'),
                JSON.parse(existingData.fourPrizes_5 || '"..."'),
                JSON.parse(existingData.fourPrizes_6 || '"..."')
            ],
            threePrizes: [
                JSON.parse(existingData.threePrizes_0 || '"..."'),
                JSON.parse(existingData.threePrizes_1 || '"..."')
            ],
            secondPrize: JSON.parse(existingData.secondPrize_0 || '["..."]'),
            firstPrize: JSON.parse(existingData.firstPrize_0 || '["..."]'),
            specialPrize: JSON.parse(existingData.specialPrize_0 || '["..."]'),
            tentinh: metadata.tentinh || tentinh,
            tinh: metadata.tinh || province,
            drawDate: targetDate,
            year: metadata.year || new Date().getFullYear(),
            month: metadata.month || new Date().getMonth() + 1
        };

        await sendData('initial', initialData);

        if (isSimulate) {
            const dataToUse = Object.keys(existingData).length > 0
                ? Object.fromEntries(Object.entries(existingData).map(([key, value]) => [key, JSON.parse(value)]))
                : mockData;
            await simulateLiveDraw(dataToUse);
            res.end();
            return;
        }

        if (!subscribers.has(channel)) {
            const subscriber = redis.createClient({ url: process.env.REDIS_URL });
            await subscriber.connect().catch(async (err) => {
                console.error(`Redis subscriber disconnected for ${channel}:`, err.message);
                await subscriber.connect();
            });

            subscriber.subscribe(channel, async (message) => {
                console.log(`Nhận Redis message trên kênh ${channel}: ${message}`);
                try {
                    const { prizeType, prizeData, tinh, drawDate } = JSON.parse(message);
                    if (prizeType && prizeData !== undefined) {
                        let data = { tentinh: provinces[tinh] || tinh, tinh, drawDate };
                        if (prizeType.includes('_')) {
                            const [basePrizeType, index] = prizeType.split('_');
                            const redisKey = `kqxs:xsmn:${drawDate}:${tinh}`;
                            const existingArray = [];
                            const prizeCount = {
                                specialPrize: 1, firstPrize: 1, secondPrize: 1, threePrizes: 2,
                                fourPrizes: 7, fivePrizes: 1, sixPrizes: 3, sevenPrizes: 1, eightPrizes: 1
                            }[basePrizeType] || 1;
                            for (let i = 0; i < prizeCount; i++) {
                                const value = await redisClient.hGet(redisKey, `${basePrizeType}_${i}`);
                                existingArray[i] = value ? JSON.parse(value) : '...';
                            }
                            existingArray[parseInt(index)] = prizeData;
                            await redisClient.hSet(redisKey, basePrizeType, JSON.stringify(existingArray));
                            data[basePrizeType] = existingArray;
                        } else {
                            data[prizeType] = prizeData;
                        }

                        subscribers.get(channel)?.clients.forEach(client => {
                            client.write(`data: ${JSON.stringify({ type: 'update', data })}\n\n`);
                            client.flush();
                        });
                        console.log(`Gửi SSE update cho ${prizeType} trên kênh ${channel}`);
                    }
                } catch (error) {
                    console.error(`Lỗi xử lý Redis message trên kênh ${channel}:`, error.message);
                }
            });

            subscribers.set(channel, { subscriber, clients: new Set([res]) });
            console.log(`Tạo subscriber mới cho ${channel}. Tổng kênh: ${subscribers.size}`);
        } else {
            subscribers.get(channel).clients.add(res);
            console.log(`Thêm client SSE vào kênh ${channel}. Số client: ${subscribers.get(channel).clients.size}`);
        }

        const keepAlive = setInterval(() => {
            res.write(': keep-alive\n\n');
            res.flush();
        }, 15000);

        req.on('close', async () => {
            clearInterval(keepAlive);
            const channelData = subscribers.get(channel);
            if (channelData) {
                channelData.clients.delete(res);
                console.log(`Client ngắt kết nối SSE cho ${redisKey}. Số client còn lại: ${channelData.clients.size}`);
                if (channelData.clients.size === 0) {
                    await channelData.subscriber.quit();
                    subscribers.delete(channel);
                    console.log(`Đóng subscriber cho kênh ${channel}`);
                }
            }
            res.end();
        });
    } catch (error) {
        console.error('Lỗi khi thiết lập SSE:', error.message);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Lỗi server SSE' })}\n\n`);
        res.end();
    }
});

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