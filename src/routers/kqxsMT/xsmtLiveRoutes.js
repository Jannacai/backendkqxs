const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const redisManager = require('../../utils/redisMT');

// Global SSE connections manager để tránh memory leaks
const sseConnections = new Map(); // { `${date}:${tinh}`: Set<res> }
const redisCheckIntervals = new Map(); // { `${date}:${tinh}`: intervalId }
const connectionStats = new Map(); // { `${date}:${tinh}`: { count: number, lastActivity: number } }

// Hàm monitoring connections
const monitorConnections = () => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 phút

    for (const [key, stats] of connectionStats.entries()) {
        if (now - stats.lastActivity > timeout) {
            console.log(`🧹 Cleanup inactive connection: ${key}`);
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

// Hàm broadcast SSE cho tất cả client của một tỉnh với batch processing
const broadcastSSE = (date, tinh, eventType, data) => {
    const connectionKey = `${date}:${tinh}`;
    const connections = sseConnections.get(connectionKey);

    if (connections && connections.size > 0) {
        const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        let sentCount = 0;
        const failedConnections = [];

        // Batch processing để tối ưu performance - TỐI ƯU CUỐI CÙNG
        const batchSize = 100; // Tăng batch size cho XSMT
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
                    console.error(`❌ Lỗi gửi SSE cho client:`, error);
                    failedConnections.push(res);
                }
            });

            // Giảm delay giữa các batch để tối ưu performance
            if (i + batchSize < connectionArray.length) {
                setImmediate(() => { });
            }
        }

        // Cleanup failed connections
        failedConnections.forEach(res => {
            connections.delete(res);
        });

        // Update stats
        connectionStats.set(connectionKey, {
            count: connections.size,
            lastActivity: Date.now()
        });

        console.log(`📡 Broadcast SSE: ${eventType} cho ${sentCount}/${connections.size} clients của ${tinh}`);
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

// Rate limiter tối ưu cho 200+ client - TỐI ƯU CUỐI CÙNG
const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 15000, // Tăng limit cho XSMT (nhiều tỉnh hơn)
    message: 'Quá nhiều yêu cầu SSE từ IP này, vui lòng thử lại sau.',
    keyGenerator: (req) => req.ip,
    skipSuccessfulRequests: true, // Bỏ qua successful requests
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiter cho các endpoint thông thường
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1000, // Tăng limit
    message: { error: 'Quá nhiều yêu cầu API, vui lòng thử lại sau một phút.' },
    skipSuccessfulRequests: true,
});

// Danh sách tỉnh theo ngày
const provincesByDay = {
    0: { 'kon-tum': { tentinh: 'Kon Tum', tinh: 'kon-tum' }, 'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' }, 'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' } },
    1: { 'phu-yen': { tentinh: 'Phú Yên', tinh: 'phu-yen' }, 'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' } },
    2: { 'dak-lak': { tentinh: 'Đắk Lắk', tinh: 'dak-lak' }, 'quang-nam': { tentinh: 'Quảng Nam', tinh: 'quang-nam' } },
    3: { 'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' }, 'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' } },
    4: { 'binh-dinh': { tentinh: 'Bình Định', tinh: 'binh-dinh' }, 'quang-tri': { tentinh: 'Quảng Trị', tinh: 'quang-tri' }, 'quang-binh': { tentinh: 'Quảng Bình', tinh: 'quang-binh' } },
    6: { 'gia-lai': { tentinh: 'Gia Lai', tinh: 'gia-lai' }, 'ninh-thuan': { tentinh: 'Ninh Thuận', tinh: 'ninh-thuan' } },
    // 6: { 'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' }, 'quang-ngai': { tentinh: 'Quảng Ngãi', tinh: 'quang-ngai' }, 'dak-nong': { tentinh: 'Đắk Nông', tinh: 'dak-nong' } },
};

// Hàm kiểm tra thời gian khởi tạo initialData
const isInitialTime = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    return hours === 17 && minutes >= 10 && minutes < 15; // 17:10–17:15
};

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

// Hàm quản lý Redis checking cho từng tỉnh
const setupRedisChecking = (date, tinh, province) => {
    const connectionKey = `${date}:${tinh}`;

    // Nếu đã có interval cho tỉnh này, không tạo mới
    if (redisCheckIntervals.has(connectionKey)) {
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
                console.log(`🧹 Cleanup lastSentData cho ${tinh}`);
            }

            const currentData = await redisManager.getAllHashData(`kqxs:xsmt:${date}:${tinh}`);

            if (Object.keys(currentData).length === 0) return;

            // So sánh với dữ liệu hiện tại và broadcast SSE nếu có thay đổi
            for (const [key, value] of Object.entries(currentData)) {
                const parsedValue = JSON.parse(value);
                const dataKey = `${key}:${parsedValue}`;

                if (parsedValue !== '...' && parsedValue !== '***' && !lastSentData.has(dataKey)) {
                    console.log(`📡 Phát hiện thay đổi Redis: ${key} = ${parsedValue} cho ${tinh}`);

                    const sseData = {
                        [key]: parsedValue,
                        drawDate: date,
                        tentinh: province.tentinh,
                        tinh: province.tinh,
                        year: new Date().getFullYear(),
                        month: new Date().getMonth() + 1,
                        lastUpdated: Date.now(),
                    };

                    // Broadcast cho tất cả client của tỉnh này
                    broadcastSSE(date, tinh, key, sseData);
                    lastSentData.add(dataKey);
                }
            }
        } catch (error) {
            console.error(`❌ Lỗi kiểm tra Redis changes cho ${tinh}:`, error);
            // Thử reconnect Redis nếu cần
            if (error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
                console.log(`🔄 Thử reconnect Redis cho ${tinh}`);
                connectRedis().catch(err => console.error('Lỗi reconnect Redis:', err));
            }
        }
    };

    // Kiểm tra thay đổi mỗi 2 giây
    const intervalId = setInterval(checkRedisChanges, 2000);
    redisCheckIntervals.set(connectionKey, intervalId);

    console.log(`🔧 Thiết lập Redis checking cho ${tinh} (${date})`);
};

// Endpoint lấy trạng thái ban đầu
router.get('/initial', apiLimiter, async (req, res) => {
    try {
        const { date, station, tinh } = req.query;
        console.log('📡 /initial request:', { date, station, tinh });

        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        // Sử dụng ngày được yêu cầu để xác định tỉnh thay vì ngày hiện tại
        const targetDateObj = parseDate(targetDate);
        const dayOfWeek = targetDateObj.getDay();
        const province = provincesByDay[dayOfWeek]?.[tinh] || provincesByDay[6]?.[tinh];

        console.log('🔍 /initial - Xác định tỉnh:', {
            targetDate,
            dayOfWeek,
            tinh,
            province,
            availableProvinces: provincesByDay[dayOfWeek] ? Object.keys(provincesByDay[dayOfWeek]) : []
        });

        if (!province || !tinh) {
            console.warn('⚠️ Tỉnh không hợp lệ cho /initial:', { tinh, province, dayOfWeek });
            return res.status(400).json({ error: 'Tỉnh không hợp lệ hoặc không được cung cấp.' });
        }

        console.log('🔍 Lấy dữ liệu từ Redis cho:', { targetDate, tinh });

        // Lấy dữ liệu từ Redis với Promise.all để tối ưu
        const [existingData, latestData, metadataStr] = await Promise.all([
            redisManager.getAllHashData(`kqxs:xsmt:${targetDate}:${tinh}`),
            redisManager.getData(`kqxs:xsmt:${targetDate}:${tinh}:latest`),
            redisManager.getHashData(`kqxs:xsmt:${targetDate}:${tinh}:meta`, 'metadata')
        ]).catch(error => {
            console.error('❌ Lỗi Redis operations:', error);
            // Fallback values
            return [{}, null, '{}'];
        });

        const metadata = JSON.parse(metadataStr || '{}');
        console.log('📊 Dữ liệu Redis:', {
            existingDataKeys: Object.keys(existingData),
            hasLatestData: !!latestData,
            metadata
        });

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
            tentinh: province.tentinh,
            tinh: province.tinh,
            year: metadata.year || new Date().getFullYear(),
            month: metadata.month || new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: metadata.lastUpdated || 0,
        };

        if (latestData) {
            const parsedLatest = JSON.parse(latestData);
            console.log('📡 Sử dụng latest data cho', tinh, parsedLatest);
            for (const key of Object.keys(parsedLatest)) {
                if (initialData[key]) {
                    initialData[key] = parsedLatest[key];
                }
            }
            initialData.lastUpdated = parsedLatest.lastUpdated || Date.now();
        } else {
            console.log('📡 Sử dụng existing data cho', tinh);
            for (const key of Object.keys(existingData)) {
                if (initialData[key]) {
                    initialData[key] = JSON.parse(existingData[key]);
                }
            }
        }

        console.log(`✅ Gửi dữ liệu khởi tạo XSMT cho ngày ${targetDate}, tỉnh ${tinh}:`, initialData);
        res.status(200).json(initialData);
    } catch (error) {
        console.error('❌ Lỗi khi lấy trạng thái ban đầu từ Redis:', error);
        res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau.' });
    }
});

// Endpoint SSE chính - Tối ưu cho 200+ client
router.get('/', sseLimiter, async (req, res) => {
    try {
        const { date, station, tinh, simulate } = req.query;
        console.log('🔌 SSE request:', { date, station, tinh, simulate });

        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? date
            : new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

        // Sử dụng ngày được yêu cầu để xác định tỉnh thay vì ngày hiện tại
        const targetDateObj = parseDate(targetDate);
        const dayOfWeek = targetDateObj.getDay();
        const province = provincesByDay[dayOfWeek]?.[tinh] || provincesByDay[6]?.[tinh];

        console.log('🔍 Xác định tỉnh:', {
            targetDate,
            dayOfWeek,
            tinh,
            province,
            availableProvinces: provincesByDay[dayOfWeek] ? Object.keys(provincesByDay[dayOfWeek]) : []
        });

        if (!province || !tinh) {
            console.warn('⚠️ Tỉnh không hợp lệ cho SSE:', { tinh, province, dayOfWeek });
            return res.status(400).end('Tỉnh không hợp lệ hoặc không được cung cấp.');
        }
        const isSimulate = simulate === 'true';
        console.log('🎯 SSE XSMT:', { targetDate, station, tinh, isSimulate });

        // Thiết lập SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Content-Encoding', 'identity');
        res.flushHeaders();

        // Gửi canary message
        res.write('event: canary\ndata: {"message":"Connection established"}\n\n');
        res.flush();
        console.log(`✅ Gửi canary message cho client XSMT, ngày ${targetDate}, tỉnh ${tinh}`);

        // Thêm client vào connection pool
        const connectionKey = `${targetDate}:${tinh}`;
        if (!sseConnections.has(connectionKey)) {
            sseConnections.set(connectionKey, new Set());
        }
        sseConnections.get(connectionKey).add(res);

        // Update connection stats
        connectionStats.set(connectionKey, {
            count: sseConnections.get(connectionKey).size,
            lastActivity: Date.now()
        });

        console.log(`👥 Client mới kết nối SSE cho ${tinh}. Tổng clients: ${sseConnections.get(connectionKey).size}`);

        // Thiết lập Redis checking cho tỉnh này (chỉ một lần)
        setupRedisChecking(targetDate, tinh, province);

        // Gửi dữ liệu ban đầu
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
            tentinh: province.tentinh,
            tinh: province.tinh,
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            dayOfWeek: new Date(parseDate(targetDate)).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: Date.now(),
        };

        // Lấy dữ liệu thực tế từ Redis
        const [existingData, latestData, metadataStr] = await Promise.all([
            redisManager.getAllHashData(`kqxs:xsmt:${targetDate}:${tinh}`),
            redisManager.getData(`kqxs:xsmt:${targetDate}:${tinh}:latest`),
            redisManager.getHashData(`kqxs:xsmt:${targetDate}:${tinh}:meta`, 'metadata')
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
            'eightPrizes_0', 'sevenPrizes_0',
            'sixPrizes_0', 'sixPrizes_1', 'sixPrizes_2',
            'fivePrizes_0',
            'fourPrizes_0', 'fourPrizes_1', 'fourPrizes_2', 'fourPrizes_3', 'fourPrizes_4', 'fourPrizes_5', 'fourPrizes_6',
            'threePrizes_0', 'threePrizes_1',
            'secondPrize_0', 'firstPrize_0', 'specialPrize_0'
        ];

        console.log('📤 Gửi dữ liệu ban đầu cho client SSE');
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
            console.log(`📡 Gửi dữ liệu ban đầu XSMT từ kho: ${prizeType} = ${prizeData}, tỉnh ${tinh}`);
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
            console.log(`🔌 Client ngắt kết nối SSE XSMT cho tỉnh ${tinh}`);
            clearInterval(keepAlive);

            // Xóa client khỏi connection pool
            const connections = sseConnections.get(connectionKey);
            if (connections) {
                connections.delete(res);
                console.log(`👥 Client disconnect. Còn lại: ${connections.size} clients cho ${tinh}`);

                // Update connection stats
                connectionStats.set(connectionKey, {
                    count: connections.size,
                    lastActivity: Date.now()
                });

                // Nếu không còn client nào, cleanup Redis checking
                if (connections.size === 0) {
                    const intervalId = redisCheckIntervals.get(connectionKey);
                    if (intervalId) {
                        clearInterval(intervalId);
                        redisCheckIntervals.delete(connectionKey);
                        console.log(`🧹 Cleanup Redis checking cho ${tinh}`);
                    }
                    // Cleanup connection stats
                    connectionStats.delete(connectionKey);
                }
            }
        });

    } catch (error) {
        console.error('❌ Lỗi khi thiết lập SSE XSMT:', error);
        res.status(500).end();
    }
});

module.exports = router;