
const express = require('express');
const router = express.Router();
const redisManager = require('../../utils/redisMT');

const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
};

const provincesByDay = {
    0: {
        'kon-tum': { tentinh: 'Kon Tum', tinh: 'kon-tum' },
        'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' },
        'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' }
    },
    1: {
        'phu-yen': { tentinh: 'Phú Yên', tinh: 'phu-yen' },
        'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' }
    },
    2: {
        'dak-lak': { tentinh: 'Đắk Lắk', tinh: 'dak-lak' },
        'quang-nam': { tentinh: 'Quảng Nam', tinh: 'quang-nam' }
    },
    3: {
        'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' },
        'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' }
    },
    4: {
        'binh-dinh': { tentinh: 'Bình Định', tinh: 'binh-dinh' },
        'quang-tri': { tentinh: 'Quảng Trị', tinh: 'quang-tri' },
        'quang-binh': { tentinh: 'Quảng Bình', tinh: 'quang-binh' }
    },
    5: {
        'gia-lai': { tentinh: 'Gia Lai', tinh: 'gia-lai' },
        'ninh-thuan': { tentinh: 'Ninh Thuận', tinh: 'ninh-thuan' }
    },
    6: {
        'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' },
        'quang-ngai': { tentinh: 'Quảng Ngãi', tinh: 'quang-ngai' },
        'dak-nong': { tentinh: 'Đắk Nông', tinh: 'dak-nong' }
    }
};

const subscribers = new Map();

const safeSSESend = (res, event, data) => {
    if (!res.writableEnded) {
        res.write(`event: ${event} \ndata: ${JSON.stringify(data)} \n\n`);
    }
};

const getSharedSubscriber = async (date, redisClient) => {
    const key = `sub:${date} `;
    if (!subscribers.has(key)) {
        const sub = redisClient.duplicate();
        await sub.connect();
        sub.on('error', (err) => console.error(`Subscriber ${date} error: `, err));
        subscribers.set(key, sub);
    }
    return subscribers.get(key);
};

router.use(async (req, res, next) => {
    try {
        req.redisClient = await redisManager.getClient();
        next();
    } catch (error) {
        console.error('Redis connection error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Database connection error' });
        }
    }
});

router.get('/initial', async (req, res) => {
    const { redisClient } = req;
    if (!redisClient) {
        return res.status(500).json({ error: 'Redis client not available' });
    }

    try {
        const { date, tinh, station = 'xsmt' } = req.query;
        const targetDate = date || new Date().toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).replace(/\//g, '-');

        const province = provincesByDay[new Date().getDay()]?.[tinh];
        if (!province) {
            return res.status(400).json({ error: 'Tỉnh không hợp lệ hoặc không có kết quả hôm nay' });
        }

        const redisKey = `kqxs:${station}:${targetDate}:${tinh} `;
        // Use Redis pipeline to batch commands
        const [existingData, latestData, metadata] = await redisClient.multi()
            .hGetAll(redisKey)
            .get(`${redisKey}: latest`)
            .hGet(`${redisKey}: meta`, 'metadata')
            .exec();

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
            station,
            tentinh: province.tentinh,
            tinh: province.tinh,
            year: metadata?.year || new Date().getFullYear(),
            month: metadata?.month || new Date().getMonth() + 1,
            dayOfWeek: new Date().toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: metadata?.lastUpdated || 0
        };

        if (latestData) {
            const parsedLatest = JSON.parse(latestData);
            Object.keys(parsedLatest).forEach(key => {
                if (initialData[key] && parsedLatest[key] !== '...') {
                    initialData[key] = parsedLatest[key];
                }
            });
            initialData.lastUpdated = parsedLatest.lastUpdated || Date.now();
        } else {
            Object.keys(existingData).forEach(key => {
                if (initialData[key] && existingData[key] !== '...') {
                    initialData[key] = JSON.parse(existingData[key]);
                }
            });
        }

        // Add cache header for 10 seconds
        res.set('Cache-Control', 'public, max-age=10');
        res.status(200).json(initialData);
    } catch (error) {
        console.error('Lỗi endpoint /initial:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Lỗi server' });
        }
    }
});

router.get('/all', async (req, res) => {
    const { redisClient } = req;
    if (!redisClient) {
        return res.status(500).end('Redis client not available');
    }

    try {
        const { date, station = 'xsmt', simulate } = req.query;
        const targetDate = date || new Date().toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).replace(/\//g, '-');

        const dayOfWeekIndex = new Date().getDay();
        const provinces = provincesByDay[dayOfWeekIndex] || provincesByDay[6];
        if (!provinces || Object.keys(provinces).length === 0) {
            return res.status(400).end('Không có tỉnh nào hợp lệ hôm nay');
        }

        res.writeHead(200, SSE_HEADERS);
        safeSSESend(res, 'init', { status: 'connected' });

        const provinceKeys = Object.keys(provinces);
        const latestDataPromises = provinceKeys.map(async tinh => {
            const redisKey = `kqxs:${station}:${targetDate}:${tinh} `;
            const latestData = await redisClient.get(`${redisKey}: latest`);
            return latestData ? JSON.parse(latestData) : null;
        });

        const latestDataArray = await Promise.all(latestDataPromises);
        latestDataArray.forEach((data, index) => {
            if (data) {
                safeSSESend(res, 'full', data);
            }
        });

        if (simulate === 'true') {
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
                specialPrize_0: '123456',
                lastUpdated: Date.now()
            };

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

            for (const province of provinceKeys) {
                for (const { key, delay } of prizeOrder) {
                    if (mockData[key]) {
                        const data = {
                            [key]: mockData[key],
                            drawDate: targetDate,
                            tentinh: provinces[province].tentinh,
                            tinh: province,
                            station,
                            lastUpdated: Date.now()
                        };
                        safeSSESend(res, key, data);

                        await Promise.all([
                            redisClient.hSet(`kqxs:${station}:${targetDate}:${province} `, key, JSON.stringify(mockData[key])),
                            redisClient.set(`kqxs:${station}:${targetDate}:${province}: latest`, JSON.stringify(data))
                        ]);

                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            return res.end();
        }

        const subscriber = await getSharedSubscriber(targetDate, redisClient);
        const channels = provinceKeys.map(tinh => `kqxs:${station}:${targetDate}:${tinh} `);

        const messageHandler = async (channel, message) => {
            try {
                const { prizeType, prizeData, ...rest } = JSON.parse(message);
                const tinh = channel.split(':').pop();
                const data = {
                    [prizeType]: prizeData,
                    drawDate: targetDate,
                    tentinh: provinces[tinh].tentinh,
                    tinh,
                    station,
                    lastUpdated: Date.now(),
                    ...rest
                };

                safeSSESend(res, prizeType, data);

                await redisClient.multi()
                    .hSet(`kqxs:${station}:${targetDate}:${tinh} `, prizeType, JSON.stringify(prizeData))
                    .set(`kqxs:${station}:${targetDate}:${tinh}: latest`, JSON.stringify(data))
                    .lPush(`kqxs: history:${station}:${targetDate}:${tinh} `, JSON.stringify(data))
                    .lTrim(`kqxs: history:${station}:${targetDate}:${tinh} `, 0, 99)
                    .expire(`kqxs:${station}:${targetDate}:${tinh} `, 24 * 60 * 60)
                    .expire(`kqxs:${station}:${targetDate}:${tinh}: latest`, 24 * 60 * 60)
                    .expire(`kqxs: history:${station}:${targetDate}:${tinh} `, 24 * 60 * 60)
                    .exec();
            } catch (error) {
                console.error('Lỗi xử lý message:', error);
            }
        };

        await Promise.all(channels.map(channel => subscriber.subscribe(channel, messageHandler)));

        const keepAlive = setInterval(() => {
            safeSSESend(res, 'ping', { time: Date.now() });
        }, 30000);

        req.on('close', () => {
            clearInterval(keepAlive);
            Promise.all(channels.map(channel => subscriber.unsubscribe(channel)))
                .then(() => console.log(`Client disconnected for ${targetDate}`));
        });

    } catch (error) {
        console.error('Lỗi SSE:', error);
        if (!res.headersSent) {
            res.status(500).end();
        }
    }
});

const cleanup = async () => {
    try {
        console.log('Cleaning up Redis connections...');
        const unsubscribePromises = Array.from(subscribers.entries()).map(([key, sub]) => {
            return sub.quit().catch(err => {
                console.error(`Lỗi khi đóng subscriber ${key}: `, err);
            });
        });

        await Promise.all(unsubscribePromises);
        subscribers.clear();
        await redisManager.close();
        console.log('Cleanup completed');
        process.exit(0);
    } catch (err) {
        console.error('Lỗi trong quá trình cleanup:', err);
        process.exit(1);
    }
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

module.exports = router;
