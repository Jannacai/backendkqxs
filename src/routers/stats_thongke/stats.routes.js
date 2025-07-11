// // routes/stats.js
// const express = require('express');
// const router = express.Router();
// const XSMB = require('../../models/XS_MB.models');

// // Thống kê tần suất số xuất hiện (giả sử chỉ tính giải đặc biệt)
// router.get('/frequency', async (req, res) => {
//     try {
//         const results = await XSMB.find({ lotteryType: 'Mega' }).select('specialPrize');
//         const frequency = {};
//         results.forEach(result => {
//             result.specialPrize.forEach(number => {
//                 frequency[number] = (frequency[number] || 0) + 1;
//             });
//         });
//         res.status(200).json(frequency);
//     } catch (error) {
//         res.status(500).json({ error: 'Internal Server Error' });
//     }
// });

// module.exports = router;