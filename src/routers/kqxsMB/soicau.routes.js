const express = require('express');
const router = express.Router();
const { getBachThuMB } = require('../../controllers/soiCauMBController');
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
const statsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Quá nhiều yêu cầu thống kê, vui lòng thử lại sau',
    keyGenerator: (req) => req.headers['x-user-id'] || req.ip,
});

// Route lấy kết quả soi cầu bạch thủ
router.get('/soi-cau-bach-thu', statsLimiter, async (req, res) => {
    await getBachThuMB(req, res);
});

// Route lấy kết quả soi cầu bạch thủ trong khoảng thời gian
router.get('/bach-thu/range', statsLimiter, async (req, res) => {
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
            res.status(500).json({ error: 'Lỗi server, vui lòng thử lại sau' });
        }
    }
});

module.exports = router;