const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const redisManager = require('../../utils/redisMT');
const { v4: uuidv4 } = require('uuid');
const { format } = require('date-fns');
const NodeCache = require('node-cache');

// Khởi tạo node-cache với TTL 30 giây
const cache = new NodeCache({ stdTTL: 45 });

// Set để theo dõi clientId đang hoạt động
const activeClients = new Set();

const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: 'Quá nhiều yêu cầu SSE từ IP này, vui lòng thử lại sau.',
    keyGenerator: (req) => req.ip,
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: { error: 'Quá nhiều yêu cầu API, vui lòng thử lại sau một phút.' },
});

const provincesByDay = {
    0: [
        { tinh: 'hue', tentinh: 'Huế' },
        { tinh: 'kon-tum', tentinh: 'Kon Tum' },
        { tinh: 'khanh-hoa', tentinh: 'Khánh Hòa' },
    ],
    1: { 'phu-yen': { tentinh: 'Phú Yên', tinh: 'phu-yen' }, 'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' } },
    2: { 'dak-lak': { tentinh: 'Đắk Lắk', tinh: 'dak-lak' }, 'quang-nam': { tentinh: 'Quảng Nam', tinh: 'quang-nam' } },
    3: { 'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' }, 'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' } },
    4: { 'binh-dinh': { tentinh: 'Bình Định', tinh: 'binh-dinh' }, 'quang-tri': { tentinh: 'Quảng Trị', tinh: 'quang-tri' }, 'quang-binh': { tentinh: 'Quảng Bình', tinh: 'quang-binh' } },
    5: { 'gia-lai': { tentinh: 'Gia Lai', tinh: 'gia-lai' }, 'ninh-thuan': { tentinh: 'Ninh Thuận', tinh: 'ninh-thuan' } },
    6: { 'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' }, 'quang-ngai': { tentinh: 'Quảng Ngãi', tinh: 'quang-ngai' }, 'dak-nong': { tentinh: 'Đắk Nông', tinh: 'dak-nong' } },
};

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

router.get('/initial', apiLimiter, async (req, res) => {
    let redisClient;
    try {
        const { date, station } = req.query;
        if (station !== 'xsmt') {
            return res.status(400).json({ error: 'Station không hợp lệ. Chỉ hỗ trợ xsmt.' });
        }
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : format(new Date(), 'dd-MM-yyyy');
        const dayOfWeek = parseDate(targetDate).getDay();
        const provinces = provincesByDay[dayOfWeek] || provincesByDay[6];
        if (!provinces) {
            return res.status(400).json({ error: 'Không có tỉnh nào cho ngày này.' });
        }

        // Kiểm tra cache
        const cacheKey = `initial:xsmt:${targetDate}`;
        let initialData = cache.get(cacheKey);
        if (initialData) {
            console.log(`Serving /initial from cache for date ${targetDate}`);
            return res.status(200).json(initialData);
        }

        redisClient = await redisManager.getClient();
        const multi = redisClient.multi();
        const metaKeys = Object.values(provinces).map(province => `${`kqxs:xsmt:${targetDate}:${province.tinh}`}:meta`);
        Object.values(provinces).forEach(province => {
            multi.hGetAll(`kqxs:xsmt:${targetDate}:${province.tinh}`);
        });
        metaKeys.forEach(key => {
            multi.hGet(key, 'metadata');
        });
        const results = await multi.exec();

        initialData = Object.values(provinces).map((province, index) => {
            const redisData = results[index] || {};
            const metadata = JSON.parse(results[index + Object.values(provinces).length] || '{}');

            const data = {
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
                tentinh: province.tentinh,
                tinh: province.tinh,
                year: new Date().getFullYear(),
                month: new Date().getMonth() + 1,
                dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
                lastUpdated: 0,
            };

            for (const key of Object.keys(redisData)) {
                data[key] = JSON.parse(redisData[key]) || data[key];
            }
            data.lastUpdated = redisData.lastUpdated ? JSON.parse(redisData.lastUpdated) : 0;
            data.year = metadata.year || data.year;
            data.month = metadata.month || data.month;
            data.tentinh = metadata.tentinh || data.tentinh;

            return data;
        });

        // Lưu vào cache
        cache.set(cacheKey, initialData, 30);
        console.log(`Gửi dữ liệu khởi tạo XSMT cho ngày ${targetDate}:`, initialData);
        res.status(200).json(initialData);
    } catch (error) {
        console.error('Error fetching initial state from Redis:', error.message);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    } finally {
        await redisManager.release(redisClient);
    }
});

router.get('/', sseLimiter, async (req, res) => {
    let redisClient, subscriber;
    const keepAliveTimeout = 90000;
    const clientKeyPrefix = 'sse:client';
    let clientId = req.query.clientId || uuidv4();

    // Đảm bảo đặt header ngay từ đầu để tránh lỗi MIME type
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'identity');
    res.flushHeaders();

    try {
        const { date, station, simulate } = req.query;
        if (station !== 'xsmt') {
            res.write('event: error\ndata: {"error":"Station không hợp lệ. Chỉ hỗ trợ xsmt."}\n\n');
            res.flush();
            return res.end();
        }
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : format(new Date(), 'dd-MM-yyyy');
        const dayOfWeek = parseDate(targetDate).getDay();
        const provinces = provincesByDay[dayOfWeek] || provincesByDay[6];
        if (!provinces) {
            res.write('event: error\ndata: {"error":"Không có tỉnh nào cho ngày này."}\n\n');
            res.flush();
            return res.end();
        }

        if (activeClients.has(clientId)) {
            console.log(`Client ${clientId} đã có kết nối hoạt động, từ chối kết nối mới.`);
            res.write(`event: error\ndata: {"error":"Kết nối trùng lặp cho clientId ${clientId}."}\n\n`);
            res.flush();
            return res.end();
        }

        activeClients.add(clientId);
        console.log(`SSE XSMT connection started for client ${clientId}, date ${targetDate}, simulate: ${simulate === 'true'}`);

        redisClient = await redisManager.getClient();
        subscriber = await redisManager.getSubscriber();

        const clientMetaKey = `${clientKeyPrefix}:meta:${clientId}:${targetDate}`;
        const existingClient = await redisClient.get(clientMetaKey);

        if (existingClient && !simulate) {
            const meta = JSON.parse(existingClient);
            if (Date.now() - meta.lastConnected < keepAliveTimeout) {
                console.log(`Reusing existing SSE connection for client ${clientId}, lastConnected: ${new Date(meta.lastConnected).toISOString()}`);
                res.write(`event: canary\ndata: {"message":"Reconnected","clientId":"${clientId}"}\n\n`);
                res.flush();
            } else {
                console.log(`Client ${clientId} expired, generating new clientId`);
                clientId = uuidv4();
                await redisClient.set(clientMetaKey, JSON.stringify({ lastConnected: Date.now() }));
                await redisClient.expire(clientMetaKey, keepAliveTimeout / 1000);
                res.write(`event: canary\ndata: {"message":"Connection established","clientId":"${clientId}"}\n\n`);
                res.flush();
                console.log(`Sent canary message for client ${clientId}, date ${targetDate}`);
            }
        } else {
            await redisClient.set(clientMetaKey, JSON.stringify({ lastConnected: Date.now() }));
            await redisClient.expire(clientMetaKey, keepAliveTimeout / 1000);
            res.write(`event: canary\ndata: {"message":"Connection established","clientId":"${clientId}"}\n\n`);
            res.flush();
            console.log(`Sent canary message for client ${clientId}, date ${targetDate}`);
        }

        const prizeTypes = [
            'eightPrizes_0', 'sevenPrizes_0', 'sixPrizes_0', 'sixPrizes_1', 'sixPrizes_2',
            'fivePrizes_0', 'fourPrizes_0', 'fourPrizes_1', 'fourPrizes_2', 'fourPrizes_3',
            'fourPrizes_4', 'fourPrizes_5', 'fourPrizes_6', 'threePrizes_0', 'threePrizes_1',
            'secondPrize_0', 'firstPrize_0', 'specialPrize_0'
        ];

        const multi = redisClient.multi();
        const metaKeys = Object.values(provinces).map(province => `${`kqxs:xsmt:${targetDate}:${province.tinh}`}:meta`);
        Object.values(provinces).forEach(province => {
            multi.hGetAll(`kqxs:xsmt:${targetDate}:${province.tinh}`);
        });
        metaKeys.forEach(key => {
            multi.hGet(key, 'metadata');
        });
        const results = await multi.exec();

        Object.values(provinces).forEach(async (province, index) => {
            if (res.writableEnded) return;
            const redisData = results[index] || {};
            const metadata = JSON.parse(results[index + Object.values(provinces).length] || '{}');

            for (const prizeType of prizeTypes) {
                const prizeData = redisData[prizeType] ? JSON.parse(redisData[prizeType]) : '...';
                const data = {
                    tinh: province.tinh,
                    tentinh: metadata.tentinh || province.tentinh,
                    prizeType,
                    prizeData,
                    year: metadata.year || new Date().getFullYear(),
                    month: metadata.month || new Date().getMonth() + 1,
                    drawDate: targetDate,
                    lastUpdated: redisData.lastUpdated ? JSON.parse(redisData.lastUpdated) : Date.now(),
                };
                if (!res.writableEnded) {
                    res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
                    res.flush();
                    console.log(`Sent initial data for client ${clientId}: ${prizeType} = ${prizeData}, tỉnh ${province.tinh}`);
                }
            }

            const fullData = {
                ...redisData,
                tinh: province.tinh,
                tentinh: metadata.tentinh || province.tentinh,
                year: metadata.year || new Date().getFullYear(),
                month: metadata.month || new Date().getMonth() + 1,
                drawDate: targetDate,
                lastUpdated: redisData.lastUpdated ? JSON.parse(redisData.lastUpdated) : Date.now(),
            };
            for (const key of Object.keys(fullData)) {
                if (prizeTypes.includes(key)) {
                    fullData[key] = JSON.parse(fullData[key] || '"..."');
                }
            }
            if (!res.writableEnded) {
                res.write(`event: full\ndata: ${JSON.stringify(fullData)}\n\n`);
                res.flush();
                console.log(`Sent SSE full data for client ${clientId}, tỉnh ${province.tinh}:`, fullData);
            }
        });

        const sendData = async (tinh, prizeType, prizeData, additionalData = {}) => {
            try {
                if (res.writableEnded) return;
                const clientExists = await redisClient.exists(clientMetaKey);
                if (!clientExists) {
                    console.log(`Client ${clientId} expired, skipping data send for ${prizeType}, tỉnh ${tinh}`);
                    return;
                }

                if (prizeData !== '...') {
                    const key = `kqxs:xsmt:${targetDate}:${tinh}`;
                    const multi = redisClient.multi();
                    multi.hSet(key, {
                        [prizeType]: JSON.stringify(prizeData),
                        lastUpdated: JSON.stringify(Date.now()),
                    });
                    multi.hSet(`${key}:meta`, 'metadata', JSON.stringify({
                        ...additionalData,
                        tentinh: additionalData.tentinh || provinces[tinh]?.tentinh || tinh,
                        tinh,
                        year: additionalData.year || new Date().getFullYear(),
                        month: additionalData.month || new Date().getMonth() + 1,
                        lastUpdated: Date.now(),
                    }));
                    multi.expire(key, 86400);
                    multi.expire(`${key}:meta`, 86400);
                    await multi.exec();

                    // Cập nhật cache
                    const cacheKey = `initial:xsmt:${targetDate}`;
                    let cachedData = cache.get(cacheKey);
                    if (!cachedData) {
                        cachedData = Object.values(provinces).map(province => ({
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
                            station: 'xsmt',
                            tentinh: province.tentinh,
                            tinh: province.tinh,
                            year: new Date().getFullYear(),
                            month: new Date().getMonth() + 1,
                            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
                            lastUpdated: 0,
                        }));
                    }
                    cachedData = cachedData.map(item =>
                        item.tinh === tinh ? { ...item, [prizeType]: prizeData, lastUpdated: Date.now() } : item
                    );
                    cache.set(cacheKey, cachedData, 30);
                    console.log(`Updated cache for ${cacheKey}, prizeType: ${prizeType}, tỉnh: ${tinh}`);

                    const data = {
                        tinh,
                        tentinh: additionalData.tentinh || provinces[tinh]?.tentinh || tinh,
                        prizeType,
                        prizeData,
                        year: additionalData.year || new Date().getFullYear(),
                        month: additionalData.month || new Date().getMonth() + 1,
                        drawDate: targetDate,
                        lastUpdated: Date.now(),
                    };
                    if (!res.writableEnded) {
                        res.write(`event: ${prizeType}\ndata: ${JSON.stringify(data)}\n\n`);
                        res.flush();
                        console.log(`Sent SSE data for client ${clientId}: ${prizeType} = ${prizeData}, tỉnh ${tinh}`);
                    }

                    const fullData = {
                        ...await redisClient.hGetAll(key),
                        tinh,
                        tentinh: additionalData.tentinh || provinces[tinh]?.tentinh || tinh,
                        year: additionalData.year || new Date().getFullYear(),
                        month: additionalData.month || new Date().getMonth() + 1,
                        drawDate: targetDate,
                        lastUpdated: Date.now(),
                    };
                    for (const key of Object.keys(fullData)) {
                        if (prizeTypes.includes(key)) {
                            fullData[key] = JSON.parse(fullData[key] || '"..."');
                        }
                    }
                    if (!res.writableEnded) {
                        res.write(`event: full\ndata: ${JSON.stringify(fullData)}\n\n`);
                        res.flush();
                        console.log(`Sent SSE full data for client ${clientId}, tỉnh ${tinh}:`, fullData);

                        // Cập nhật cache cho sự kiện full
                        cachedData = cachedData.map(item =>
                            item.tinh === tinh ? { ...item, ...fullData, lastUpdated: Date.now() } : item
                        );
                        cache.set(cacheKey, cachedData, 30);
                        console.log(`Updated cache for ${cacheKey}, full data, tỉnh: ${tinh}`);
                    }

                    await redisClient.set(clientMetaKey, JSON.stringify({ lastConnected: Date.now() }));
                    await redisClient.expire(clientMetaKey, keepAliveTimeout / 1000);
                } else {
                    console.log(`Bỏ qua gửi ${prizeType} = ${prizeData} cho tỉnh ${tinh}, là "..." cho client ${clientId}`);
                }
            } catch (error) {
                console.error(`Lỗi gửi SSE XSMT (${prizeType}, tỉnh ${tinh}) cho client ${clientId}:`, error);
                if (!res.writableEnded) {
                    res.write(`event: error\ndata: {"error":"Lỗi xử lý dữ liệu SSE, thử lại sau."}\n\n`);
                    res.flush();
                }
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

        const simulateLiveDraw = async (tinh) => {
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
            const key = `kqxs:xsmt:${targetDate}:${tinh}`;
            const multi = redisClient.multi();
            for (const { key: prizeType, delay } of prizeOrder) {
                if (mockData[prizeType]) {
                    multi.hSet(key, {
                        [prizeType]: JSON.stringify(mockData[prizeType]),
                        lastUpdated: JSON.stringify(Date.now()),
                    });
                    multi.hSet(`${key}:meta`, 'metadata', JSON.stringify({
                        tentinh: provinces[tinh]?.tentinh || tinh,
                        tinh,
                        year: 2025,
                        month: 7,
                        lastUpdated: Date.now(),
                    }));
                    multi.expire(key, 86400);
                    multi.expire(`${key}:meta`, 86400);
                    await multi.exec();
                    await sendData(tinh, prizeType, mockData[prizeType], { tentinh: provinces[tinh]?.tentinh || tinh, tinh, year: 2025, month: 7 });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        if (simulate === 'true') {
            console.log(`Bắt đầu mô phỏng quay số XSMT cho ngày ${targetDate} cho client ${clientId}`);
            for (const province of Object.values(provinces)) {
                await simulateLiveDraw(province.tinh);
            }
            await redisManager.release(subscriber);
            await redisManager.release(redisClient);
            activeClients.delete(clientId);
            if (!res.writableEnded) res.end();
            return;
        }

        const channel = `xsmt:${targetDate}`;
        await subscriber.subscribe(channel, async (message) => {
            console.log(`Nhận Redis message XSMT cho kênh ${channel} cho client ${clientId}:`, message);
            try {
                const { prizeType, prizeData, tentinh, tinh, year, month, drawDate } = JSON.parse(message);
                if (tinh && prizeType && prizeData && provinces[tinh] && drawDate === targetDate) {
                    await sendData(tinh, prizeType, prizeData, { tentinh, tinh, year, month, drawDate });
                } else {
                    console.warn(`Dữ liệu Redis không hợp lệ cho client ${clientId}:`, message);
                    if (!res.writableEnded) {
                        res.write(`event: error\ndata: {"error":"Dữ liệu Redis không hợp lệ."}\n\n`);
                        res.flush();
                    }
                }
            } catch (error) {
                console.error(`Lỗi xử lý Redis message XSMT cho client ${clientId}:`, error);
                if (!res.writableEnded) {
                    res.write(`event: error\ndata: {"error":"Lỗi xử lý dữ liệu Redis, thử lại sau."}\n\n`);
                    res.flush();
                }
            }
        });

        const keepAlive = setInterval(() => {
            if (res.writableEnded) {
                clearInterval(keepAlive);
                activeClients.delete(clientId);
                return;
            }
            res.write(': keep-alive\n\n');
            res.flush();
            console.log(`Gửi keep-alive cho client XSMT ${clientId}, ngày ${targetDate}`);
        }, 4000);

        req.on('close', async () => {
            console.log(`Client ${clientId} disconnected, scheduling cleanup in ${keepAliveTimeout / 1000}s`);
            clearInterval(keepAlive);
            activeClients.delete(clientId);
            const cleanupTimeout = setTimeout(async () => {
                const clientExists = await redisClient.exists(clientMetaKey);
                if (!clientExists) {
                    console.log(`Client ${clientId} cleanup: no reconnection within ${keepAliveTimeout / 1000}s`);
                    await redisClient.del(clientMetaKey);
                    await subscriber.unsubscribe(channel);
                    console.log(`Unsubscribed channel ${channel} for client ${clientId}`);
                    await redisManager.release(subscriber);
                    await redisManager.release(redisClient);
                    if (!res.writableEnded) res.end();
                    console.log(`Client ${clientId} SSE connection fully closed`);
                } else {
                    console.log(`Client ${clientId} reconnected within ${keepAliveTimeout / 1000}s, skipping cleanup`);
                }
            }, keepAliveTimeout);
        });
    } catch (error) {
        console.error(`Lỗi khi thiết lập SSE XSMT cho client ${clientId}:`, error);
        activeClients.delete(clientId);
        if (!res.writableEnded) {
            res.write(`event: error\ndata: {"error":"Lỗi thiết lập kết nối SSE, thử lại sau."}\n\n`);
            res.flush();
            res.end();
        }
        await redisManager.release(subscriber);
        await redisManager.release(redisClient);
    }
});

module.exports = router;