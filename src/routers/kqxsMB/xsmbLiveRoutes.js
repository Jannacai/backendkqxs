// Cần test thử cho ngày 17/07
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const redisManager = require('../../utils/redisMB');

// Global SSE connections manager để tránh memory leaks
const sseConnections = new Map(); // { `${date}`: Set<res> }
const redisCheckIntervals = new Map(); // { `${date}`: intervalId }
const connectionStats = new Map(); // { `${date}`: { count: number, lastActivity: number } }

// BỔ SUNG: Performance monitoring cho backend
const performanceMonitor = {
    startTime: Date.now(),
    metrics: {
        sseConnections: 0,
        broadcasts: 0,
        redisOperations: 0,
        errors: 0
    },
    log: (metric, value = 1) => {
        performanceMonitor.metrics[metric] += value;
        if (performanceMonitor.metrics[metric] % 50 === 0) {
            console.log(`📊 Backend Performance XSMB - ${metric}: ${performanceMonitor.metrics[metric]}`);
        }
    }
};

// BỔ SUNG: Tối ưu console.log - chỉ log quan trọng
const debugLog = (message, data = null) => {
    if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 Backend XSMB: ${message}`, data);
    } else if (process.env.NODE_ENV === 'production') {
        // Production logging - chỉ log errors và critical events
        if (message.includes('Error') || message.includes('Failed') || message.includes('Critical')) {
            console.error(`🚨 Production XSMB: ${message}`, data);
        }
    }
};

// Hàm monitoring connections tối ưu
const monitorConnections = () => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 phút

    for (const [key, stats] of connectionStats.entries()) {
        if (now - stats.lastActivity > timeout) {
            debugLog(`Cleanup inactive connection: ${key}`);
            const connections = sseConnections.get(key);
            if (connections) {
                connections.clear();
                sseConnections.delete(key);
            }
            connectionStats.delete(key);
        }
    }
};

// Chạy monitoring mỗi phút
setInterval(monitorConnections, 60000);

// Hàm broadcast SSE tối ưu cho 200+ client
const broadcastSSE = (date, eventType, data) => {
    const connections = sseConnections.get(date);

    if (connections && connections.size > 0) {
        const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        let sentCount = 0;
        const failedConnections = [];

        // ✅ TỐI ƯU: Dynamic batch processing dựa trên số lượng connections
        const connectionCount = connections.size;
        const batchSize = connectionCount > 200 ? 50 : connectionCount > 100 ? 75 : 100; // Adaptive batch size
        const connectionArray = Array.from(connections);

        for (let i = 0; i < connectionArray.length; i += batchSize) {
            const batch = connectionArray.slice(i, i + batchSize);

            batch.forEach(res => {
                try {
                    if (!res.writableEnded) {
                        res.write(message);
                        res.flush();
                        sentCount++;
                    } else {
                        failedConnections.push(res);
                    }
                } catch (error) {
                    debugLog(`Lỗi gửi SSE cho client:`, error);
                    failedConnections.push(res);
                    performanceMonitor.log('errors');
                }
            });

            // Giảm delay giữa các batch
            if (i + batchSize < connectionArray.length) {
                setImmediate(() => { });
            }
        }

        // Cleanup failed connections
        failedConnections.forEach(res => {
            connections.delete(res);
        });

        // Update stats
        connectionStats.set(date, {
            count: connections.size,
            lastActivity: Date.now()
        });

        performanceMonitor.log('broadcasts');
        debugLog(`Broadcast SSE: ${eventType} cho ${sentCount}/${connections.size} clients`);
    }
};

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
    try {
        await redisManager.getClient();
    } catch (error) {
        console.error('❌ Lỗi kết nối Redis:', error);
    }
};
connectRedis().catch(err => console.error('Lỗi kết nối Redis:', err));

// Rate limiter tối ưu cho 200+ client
const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 10000, // Tăng limit cho nhiều client
    message: 'Quá nhiều yêu cầu SSE từ IP này, vui lòng thử lại sau.',
    keyGenerator: (req) => req.ip,
    skipSuccessfulRequests: true, // Bỏ qua successful requests
});

// Rate limiter cho các endpoint thông thường
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1000, // Tăng limit
    message: { error: 'Quá nhiều yêu cầu API, vui lòng thử lại sau một phút.' },
    skipSuccessfulRequests: true,
});

// Hàm parse ngày
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

// Hàm quản lý Redis checking cho XSMB
const setupRedisChecking = (date) => {
    // Nếu đã có interval cho ngày này, không tạo mới
    if (redisCheckIntervals.has(date)) {
        return;
    }

    let lastSentData = new Set();
    let lastCleanupTime = Date.now();
    const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 phút cleanup một lần

    const checkRedisChanges = async () => {
        try {
            // Cleanup lastSentData định kỳ để tránh memory leak
            const now = Date.now();
            if (now - lastCleanupTime > CLEANUP_INTERVAL) {
                lastSentData.clear();
                lastCleanupTime = now;
                debugLog(`Cleanup lastSentData cho XSMB`);
            }

            const currentData = await redisManager.getAllHashData(`kqxs:${date}`);

            if (Object.keys(currentData).length === 0) return;

            // So sánh với dữ liệu hiện tại và broadcast SSE nếu có thay đổi
            for (const [key, value] of Object.entries(currentData)) {
                const parsedValue = JSON.parse(value);
                const dataKey = `${key}:${parsedValue}`;

                if (parsedValue !== '...' && parsedValue !== '***' && !lastSentData.has(dataKey)) {
                    debugLog(`Phát hiện thay đổi Redis: ${key} = ${parsedValue} cho XSMB`);

                    const sseData = {
                        [key]: parsedValue,
                        drawDate: date,
                        tentinh: 'Miền Bắc',
                        tinh: 'MB',
                        year: new Date().getFullYear(),
                        month: new Date().getMonth() + 1,
                        lastUpdated: Date.now(),
                    };

                    // Broadcast cho tất cả client
                    broadcastSSE(date, key, sseData);
                    lastSentData.add(dataKey);
                }
            }
        } catch (error) {
            console.error(`❌ Lỗi kiểm tra Redis changes cho XSMB:`, error);
            // Thử reconnect Redis nếu cần
            if (error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
                debugLog(`Thử reconnect Redis cho XSMB`);
                connectRedis().catch(err => console.error('Lỗi reconnect Redis:', err));
            }
        }
    };

    // Kiểm tra thay đổi mỗi 2 giây
    const intervalId = setInterval(checkRedisChanges, 2000);
    redisCheckIntervals.set(date, intervalId);

    debugLog(`Thiết lập Redis checking cho XSMB (${date})`);
};

// Endpoint lấy trạng thái ban đầu
router.get('/initial', apiLimiter, async (req, res) => {
    try {
        const { date, station } = req.query;
        debugLog('Initial request:', { date, station });

        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        debugLog('Fetching data from Redis for:', { targetDate });

        // Lấy dữ liệu từ Redis với Promise.all để tối ưu
        const [existingData, latestData, metadataStr] = await Promise.all([
            redisManager.getAllHashData(`kqxs:${targetDate}`),
            redisManager.getData(`kqxs:${targetDate}:latest`),
            redisManager.getHashData(`kqxs:${targetDate}:meta`, 'metadata')
        ]).catch(error => {
            console.error('❌ Lỗi Redis operations:', error);
            // Fallback values
            return [{}, null, '{}'];
        });

        const metadata = JSON.parse(metadataStr || '{}');
        debugLog('Redis data:', {
            existingDataKeys: Object.keys(existingData),
            hasLatestData: !!latestData,
            metadata
        });

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
            debugLog('Using latest data for XSMB', parsedLatest);
            for (const key of Object.keys(parsedLatest)) {
                if (initialData[key]) {
                    initialData[key] = parsedLatest[key];
                }
            }
            initialData.lastUpdated = parsedLatest.lastUpdated || Date.now();
        } else {
            debugLog('Using existing data for XSMB');
            for (const key of Object.keys(existingData)) {
                if (initialData[key]) {
                    initialData[key] = JSON.parse(existingData[key]);
                }
            }
        }

        debugLog(`Sending initial XSMB data for ${targetDate}:`, initialData);
        res.status(200).json(initialData);
    } catch (error) {
        console.error('❌ Error fetching initial state from Redis:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    }
});

// Endpoint SSE chính - Tối ưu cho 200+ client
router.get('/', sseLimiter, async (req, res) => {
    try {
        const { date, station, simulate } = req.query;
        debugLog('SSE request:', { date, station, simulate });

        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        debugLog('SSE XSMB:', { targetDate, station });

        const isSimulate = simulate === 'true';
        debugLog('SSE XSMB:', { targetDate, station, isSimulate });

        // Thiết lập SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'identity');
        res.flushHeaders();

        // Gửi canary message
        res.write('event: canary\ndata: {"message":"Connection established"}\n\n');
        res.flush();
        debugLog(`Sent canary message to XSMB client, date ${targetDate}`);

        // Thêm client vào connection pool
        if (!sseConnections.has(targetDate)) {
            sseConnections.set(targetDate, new Set());
        }
        sseConnections.get(targetDate).add(res);

        // Update connection stats
        connectionStats.set(targetDate, {
            count: sseConnections.get(targetDate).size,
            lastActivity: Date.now()
        });

        debugLog(`New SSE client connected for XSMB. Total clients: ${sseConnections.get(targetDate).size}`);

        // Thiết lập Redis checking cho ngày này (chỉ một lần)
        setupRedisChecking(targetDate);

        // Gửi dữ liệu ban đầu
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
            tentinh: 'Miền Bắc',
            tinh: 'MB',
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: Date.now(),
        };

        // Lấy dữ liệu thực tế từ Redis
        const [existingData, latestData, metadataStr] = await Promise.all([
            redisManager.getAllHashData(`kqxs:${targetDate}`),
            redisManager.getData(`kqxs:${targetDate}:latest`),
            redisManager.getHashData(`kqxs:${targetDate}:meta`, 'metadata')
        ]);

        const metadata = JSON.parse(metadataStr || '{}');

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

        // Gửi dữ liệu ban đầu cho client này
        const prizeTypes = [
            'firstPrize_0', 'secondPrize_0', 'secondPrize_1',
            'threePrizes_0', 'threePrizes_1', 'threePrizes_2', 'threePrizes_3', 'threePrizes_4', 'threePrizes_5',
            'fourPrizes_0', 'fourPrizes_1', 'fourPrizes_2', 'fourPrizes_3',
            'fivePrizes_0', 'fivePrizes_1', 'fivePrizes_2', 'fivePrizes_3', 'fivePrizes_4', 'fivePrizes_5',
            'sixPrizes_0', 'sixPrizes_1', 'sixPrizes_2',
            'sevenPrizes_0', 'sevenPrizes_1', 'sevenPrizes_2', 'sevenPrizes_3',
            'maDB', 'specialPrize_0'
        ];

        debugLog('Sending initial data to SSE client');
        for (const prizeType of prizeTypes) {
            const prizeData = initialData[prizeType];
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
            debugLog(`Sent initial XSMB data from Redis: ${prizeType} = ${prizeData}`);
        }

        // Keep-alive cho client này
        const keepAlive = setInterval(() => {
            if (res.writableEnded) {
                clearInterval(keepAlive);
                return;
            }
            res.write(': keep-alive\n\n');
            res.flush();
        }, 4000);

        // Cleanup khi client disconnect
        req.on('close', () => {
            debugLog(`Client disconnected SSE XSMB for ${targetDate}`);
            clearInterval(keepAlive);

            // Xóa client khỏi connection pool
            const connections = sseConnections.get(targetDate);
            if (connections) {
                connections.delete(res);
                debugLog(`Client disconnect. Remaining: ${connections.size} clients for XSMB`);

                // Update connection stats
                connectionStats.set(targetDate, {
                    count: connections.size,
                    lastActivity: Date.now()
                });

                // Nếu không còn client nào, cleanup Redis checking
                if (connections.size === 0) {
                    const intervalId = redisCheckIntervals.get(targetDate);
                    if (intervalId) {
                        clearInterval(intervalId);
                        redisCheckIntervals.delete(targetDate);
                        debugLog(`Cleanup Redis checking for XSMB`);
                    }
                    // Cleanup connection stats
                    connectionStats.delete(targetDate);
                }
            }
        });

    } catch (error) {
        console.error('❌ Error setting up SSE XSMB:', error);
        res.status(500).end();
    }
});

module.exports = router;