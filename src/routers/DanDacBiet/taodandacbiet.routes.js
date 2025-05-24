const express = require('express');
const router = express.Router();
const { createDanDacBiet } = require('../../controllers/taodandacbiet');
const rateLimit = require('express-rate-limit');
const redis = require('redis');

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => console.error('Lỗi kết nối Redis:', err));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
});

router.post('/xsmb/tao-dan-dac-biet', apiLimiter, async (req, res) => {
    const { days, tinh } = req.query;
    const { dau, duoi, tong, kep, soDanhSach } = req.body;

    try {
        if (!days || !['30', '60', '90', '120', '180', '365'].includes(days.toString())) {
            return res.status(400).json({ error: 'Tham số days không hợp lệ. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.' });
        }

        const cacheKey = `taoDanDacBiet:${days}:${tinh || 'all'}:${JSON.stringify({ dau, duoi, tong, kep, soDanhSach })}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await createDanDacBiet(days, tinh, { dau, duoi, tong, kep, soDanhSach });
        await redisClient.setEx(cacheKey, 1800, JSON.stringify(result));
        console.log(`Đã cache dữ liệu: ${cacheKey}`);

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi trong route tao-dan-dac-biet:', error.message);
        res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
    }
});

module.exports = router;