// Cần test thử cho ngày 17/07
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const redis = require('redis');

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => console.error('Lỗi kết nối Redis:', err));

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

const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: 'Quá nhiều yêu cầu SSE từ IP này, vui lòng thử lại sau.',
    keyGenerator: (req) => req.ip,
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
});

router.get('/initial', apiLimiter, async (req, res) => {
    try {
        const { date, station } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        let existingData = await redisClient.hGetAll(`kqxs:${targetDate}`);
        const latestData = await redisClient.get(`kqxs:${targetDate}:latest`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:${targetDate}:meta`, 'metadata')) || '{}');

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
        } else {
            for (const key of Object.keys(existingData)) {
                if (initialData[key]) {
                    initialData[key] = JSON.parse(existingData[key]);
                }
            }
        }

        console.log(`Gửi dữ liệu khởi tạo cho ngày ${targetDate}:`, initialData);
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
        console.log('SSE target date:', targetDate, 'Simulate:', isSimulate, 'Station:', station);

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'identity');
        res.flushHeaders();

        res.write('event: canary\ndata: {"message":"Connection established"}\n\n');
        res.flush();
        console.log(`Gửi canary message cho client, ngày ${targetDate}`);

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
            fourPrizes_4: '...',
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
            tentinh: 'Miền Bắc',
            tinh: 'MB',
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: Date.now(),
        };

        let existingData = await redisClient.hGetAll(`kqxs:${targetDate}`);
        const latestData = await redisClient.get(`kqxs:${targetDate}:latest`);
        const metadata = JSON.parse((await redisClient.hGet(`kqxs:${targetDate}:meta`, 'metadata')) || '{}');
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
        for (const [prizeType, prizeData] of Object.entries(initialData)) {
            const data = {
                [prizeType]: prizeData,
                drawDate: targetDate,
                tentinh: metadata.tentinh || 'Miền Bắc',
                tinh: metadata.tinh || 'MB',
                year: metadata.year || new Date().getFullYear(),
                month: metadata.month || new Date().getMonth() + 1,
                lastUpdated: initialData.lastUpdated,
            };
            res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
            res.flush();
            console.log(`Gửi dữ liệu ban đầu từ kho: ${prizeType} = ${prizeData}`);
        }

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
                    lastUpdated: Date.now(),
                };
                await redisClient.hSet(`kqxs:${targetDate}`, prizeType, JSON.stringify(prizeData));
                await redisClient.hSet(`kqxs:${targetDate}:meta`, 'metadata', JSON.stringify({
                    ...additionalData,
                    lastUpdated: data.lastUpdated,
                }));
                await redisClient.expire(`kqxs:${targetDate}`, 86400);
                await redisClient.expire(`kqxs:${targetDate}:meta`, 86400);

                let latestData = await redisClient.get(`kqxs:${targetDate}:latest`);
                let fullData = latestData ? JSON.parse(latestData) : { ...initialData };
                fullData[prizeType] = prizeData;
                fullData.lastUpdated = data.lastUpdated;
                fullData.tentinh = data.tentinh;
                fullData.tinh = data.tinh;
                fullData.year = data.year;
                fullData.month = data.month;
                await redisClient.set(`kqxs:${targetDate}:latest`, JSON.stringify(fullData));
                await redisClient.expire(`kqxs:${targetDate}:latest`, 86400);

                res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
                res.flush();
                console.log(`Gửi SSE: ${prizeType} = ${prizeData} cho ngày ${targetDate}`);

                if (prizeType === 'sixPrizes_1') {
                    res.write(`event: full\ndata: ${JSON.stringify(fullData)}\n\n`);
                    res.flush();
                    console.log(`Gửi SSE full cho ngày ${targetDate}:`, fullData);
                }
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
            lastUpdated: Date.now(),
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

        if (isSimulate) {
            console.log('Bắt đầu mô phỏng quay số cho ngày:', targetDate);
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
                console.log(`Đã kết nối Redis subscriber cho kênh xsmb:${targetDate}`);
                await subscriber.subscribe(`xsmb:${targetDate}`, async (message) => {
                    console.log('Nhận Redis message:', message);
                    try {
                        const { prizeType, prizeData, tentinh, tinh, year, month } = JSON.parse(message);
                        if (prizeType && prizeData) {
                            await sendData(prizeType, prizeData, { tentinh, tinh, year, month });
                            retryCount = 0;
                        } else {
                            console.warn('Dữ liệu Redis không hợp lệ:', message);
                        }
                    } catch (error) {
                        console.error('Lỗi xử lý Redis message:', error);
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
            console.log(`Gửi keep-alive cho client, ngày ${targetDate}`);
        }, 2000);

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