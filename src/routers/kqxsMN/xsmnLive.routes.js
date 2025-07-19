const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const redis = require('redis');

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

// Hàm parse ngày tháng
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

// Rate limiter cho các endpoint thông thường
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: 'Quá nhiều yêu cầu API, vui lòng thử lại sau một phút.' },
});

// Rate limiter cho SSE
const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: 'Quá nhiều yêu cầu SSE từ IP này, vui lòng thử lại sau.',
    keyGenerator: (req) => req.ip,
});

// Hàm kiểm tra thời gian khởi tạo initialData
const isInitialTime = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    return hours === 16 && minutes >= 10 && minutes < 15; // 16:10–16:15
};

// Endpoint lấy trạng thái ban đầu
router.get('/initial', apiLimiter, async (req, res) => {
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
        let existingData = await redisClient.hGetAll(`kqxs:xsmn:${targetDate}:${tinh}`);
        const latestData = await redisClient.get(`kqxs:xsmn:${targetDate}:${tinh}:latest`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmn:${targetDate}:${tinh}:meta`, 'metadata')) || '{}');

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
            station: station || 'xsmn',
            tentinh: province.tentinh,
            tinh: province.tinh,
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: metadata.lastUpdated || 0,
        };

        if (latestData) {
            const parsedLatest = JSON.parse(latestData);
            for (const key of Object.keys(parsedLatest)) {
                if (initialData[key]) {
                    initialData[key] = parsedLatest[key];
                }
            }
            initialData.lastUpdated = parsedLatest.lastUpdated || Date.now();
        } else if (isInitialTime()) {
            await redisClient.setEx(`kqxs:xsmn:${targetDate}:${tinh}:latest`, 86400, JSON.stringify(initialData));
        } else {
            for (const key of Object.keys(existingData)) {
                if (initialData[key]) {
                    initialData[key] = JSON.parse(existingData[key]);
                }
            }
        }

        console.log(`Gửi dữ liệu khởi tạo cho ngày ${targetDate}, tỉnh ${tinh}:`, initialData);
        res.status(200).json(initialData);
    } catch (error) {
        console.error('Lỗi khi lấy trạng thái ban đầu từ Redis:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    }
});

// SSE cho XSMN
router.get('/', sseLimiter, async (req, res) => {
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
        console.log('SSE XSMN:', { targetDate, station, tinh, isSimulate });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'identity');
        res.flushHeaders();

        res.write('event: canary\ndata: {"message":"Connection established"}\n\n');
        res.flush();
        console.log(`Gửi canary message cho client, ngày ${targetDate}, tỉnh ${tinh}`);

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
            station: station || 'xsmn',
            tentinh: province.tentinh,
            tinh: province.tinh,
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: Date.now(),
        };

        let existingData = await redisClient.hGetAll(`kqxs:xsmn:${targetDate}:${tinh}`);
        const latestData = await redisClient.get(`kqxs:xsmn:${targetDate}:${tinh}:latest`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:xsmn:${targetDate}:${tinh}:meta`, 'metadata')) || '{}');

        if (latestData) {
            const parsedLatest = JSON.parse(latestData);
            for (const key of Object.keys(parsedLatest)) {
                if (initialData[key]) {
                    initialData[key] = parsedLatest[key];
                }
            }
            initialData.lastUpdated = parsedLatest.lastUpdated || Date.now();
        } else {
            for (const key of Object.keys(existingData)) {
                if (initialData[key]) {
                    initialData[key] = JSON.parse(existingData[key]);
                }
            }
        }

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
            const data = {
                [prizeType]: prizeData,
                drawDate: targetDate,
                tentinh: metadata.tentinh || province.tentinh,
                tinh: metadata.tinh || province.tinh,
                year: metadata.year || new Date().getFullYear(),
                month: metadata.month || new Date().getMonth() + 1,
                lastUpdated: initialData.lastUpdated,
            };
            res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
            res.flush();
            console.log(`Gửi dữ liệu ban đầu từ kho: ${prizeType} = ${prizeData}, tỉnh ${tinh}`);
        }

        const sendData = async (prizeType, prizeData, additionalData = {}) => {
            try {
                if (prizeData === '...') {
                    const currentData = await redisClient.hGet(`kqxs:xsmn:${targetDate}:${tinh}`, prizeType);
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
                    lastUpdated: Date.now(),
                };
                await redisClient.hSet(`kqxs:xsmn:${targetDate}:${tinh}`, prizeType, JSON.stringify(prizeData));
                await redisClient.hSet(`kqxs:xsmn:${targetDate}:${tinh}:meta`, 'metadata', JSON.stringify({
                    ...additionalData,
                    lastUpdated: data.lastUpdated,
                }));
                await redisClient.expire(`kqxs:xsmn:${targetDate}:${tinh}`, 86400);
                await redisClient.expire(`kqxs:xsmn:${targetDate}:${tinh}:meta`, 86400);

                let latestData = await redisClient.get(`kqxs:xsmn:${targetDate}:${tinh}:latest`);
                let fullData = latestData ? JSON.parse(latestData) : { ...initialData };
                fullData[prizeType] = prizeData;
                fullData.lastUpdated = data.lastUpdated;
                fullData.tentinh = data.tentinh;
                fullData.tinh = data.tinh;
                fullData.year = data.year;
                fullData.month = data.month;
                await redisClient.set(`kqxs:xsmn:${targetDate}:${tinh}:latest`, JSON.stringify(fullData));
                await redisClient.expire(`kqxs:xsmn:${targetDate}:${tinh}:latest`, 86400);

                res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
                res.flush();
                console.log(`Gửi SSE: ${prizeType} = ${prizeData} cho ngày ${targetDate}, tỉnh ${tinh}`);

                if (prizeType === 'sixPrizes_1') {
                    res.write(`event: full\ndata: ${JSON.stringify(fullData)}\n\n`);
                    res.flush();
                    console.log(`Gửi SSE full cho ngày ${targetDate}, tỉnh ${tinh}:`, fullData);
                }
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
            lastUpdated: Date.now(),
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

        if (isSimulate) {
            console.log(`Bắt đầu mô phỏng quay số cho ngày ${targetDate}, tỉnh ${tinh}`);
            await simulateLiveDraw(mockData);
            res.end();
            return;
        }

        const subscriber = redis.createClient({ url: process.env.REDIS_URL });
        let retryCount = 0;
        const maxRetries = 5;
        const retryDelay = 2000;

        const connectSubscriber = async () => {
            try {
                await subscriber.connect();
                console.log(`Đã kết nối Redis subscriber cho kênh xsmn:${targetDate}:${tinh}`);
                await subscriber.subscribe(`xsmn:${targetDate}:${tinh}`, async (message) => {
                    console.log('Nhận Redis message XSMN:', message);
                    try {
                        const { prizeType, prizeData, tentinh, tinh, year, month } = JSON.parse(message);
                        if (prizeType && prizeData) {
                            await sendData(prizeType, prizeData, { tentinh, tinh, year, month });
                            retryCount = 0;
                        } else {
                            console.warn('Dữ liệu Redis không hợp lệ:', message);
                        }
                    } catch (error) {
                        console.error('Lỗi xử lý Redis message XSMN:', error);
                    }
                });
            } catch (error) {
                console.error('Lỗi kết nối Redis subscriber:', error);
                if (retryCount < maxRetries) {
                    retryCount++;
                    console.log(`Thử kết nối lại Redis subscriber (lần ${retryCount}/${maxRetries}) sau ${retryDelay}ms`);
                    setTimeout(connectSubscriber, retryDelay);
                } else {
                    console.error('Hết số lần thử kết nối Redis subscriber');
                }
            }
        };

        await connectSubscriber();

        const keepAlive = setInterval(() => {
            if (res.writableEnded) {
                clearInterval(keepAlive);
                return;
            }
            res.write(': keep-alive\n\n');
            res.flush();
            console.log(`Gửi keep-alive cho client, ngày ${targetDate}, tỉnh ${tinh}`);
        }, 2000);

        req.on('close', async () => {
            clearInterval(keepAlive);
            await subscriber.quit();
            res.end();
            console.log(`Client ngắt kết nối SSE XSMN cho tỉnh ${tinh}`);
        });
    } catch (error) {
        console.error('Lỗi khi thiết lập SSE XSMN:', error);
        res.status(500).end();
    }
});

module.exports = router;