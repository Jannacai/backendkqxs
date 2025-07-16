const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const redis = require('redis');

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

router.get('/initial', apiLimiter, async (req, res) => {
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
            maDB: '...',
            specialPrize_0: '...',
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

router.get('/', sseLimiter, async (req, res) => {
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
                if (prizeData === '...') {
                    const currentData = await redisClient.hGet(`kqxs:${targetDate}`, prizeType);
                    if (currentData && JSON.parse(currentData) !== '...') {
                        console.warn(`Bỏ qua ghi ${prizeType} = "..." vì đã có giá trị: ${currentData}`);
                        return;
                    }
                }
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
            sevenPrizes_3: '98',
            maDB: '1ER - 13ER - 10ER - 7ER - 4ER - 8ER',
            specialPrize_0: '12345',
        };

        const simulateLiveDraw = async (data) => {
            const prizeOrder = [
                { key: 'firstPrize_0', delay: 500 },
                { key: 'secondPrize_0', delay: 500 },
                { key: 'secondPrize_1', delay: 500 },
                { key: 'threePrizes_0', delay: 500 },
                { key: 'threePrizes_1', delay: 500 },
                { key: 'threePrizes_2', delay: 500 },
                { key: 'threePrizes_3', delay: 500 },
                { key: 'threePrizes_4', delay: 500 },
                { key: 'threePrizes_5', delay: 500 },
                { key: 'fourPrizes_0', delay: 500 },
                { key: 'fourPrizes_1', delay: 500 },
                { key: 'fourPrizes_2', delay: 500 },
                { key: 'fourPrizes_3', delay: 500 },
                { key: 'fivePrizes_0', delay: 500 },
                { key: 'fivePrizes_1', delay: 500 },
                { key: 'fivePrizes_2', delay: 500 },
                { key: 'fivePrizes_3', delay: 500 },
                { key: 'fivePrizes_4', delay: 500 },
                { key: 'fivePrizes_5', delay: 500 },
                { key: 'sixPrizes_0', delay: 500 },
                { key: 'sixPrizes_1', delay: 500 },
                { key: 'sixPrizes_2', delay: 500 },
                { key: 'sevenPrizes_0', delay: 500 },
                { key: 'sevenPrizes_1', delay: 500 },
                { key: 'sevenPrizes_2', delay: 500 },
                { key: 'sevenPrizes_3', delay: 500 },
                { key: 'maDB', delay: 500 },
                { key: 'specialPrize_0', delay: 500 },
            ];

            for (const { key, delay } of prizeOrder) {
                if (data[key]) {
                    await sendData(key, data[key], { tentinh: 'Miền Bắc', tinh: 'MB', year: 2025, month: 4 });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        const initialData = {
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
            maDB: '...',
            specialPrize_0: '...',
        };

        let existingData = await redisClient.hGetAll(`kqxs:${targetDate}`);
        console.log('Dữ liệu Redis ban đầu từ Redis...:', existingData);
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

module.exports = router;