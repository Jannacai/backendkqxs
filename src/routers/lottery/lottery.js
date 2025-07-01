"use strict";

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const moment = require('moment');
require('moment-timezone');
const { authenticate } = require('../auth/auth.routes');
const userModel = require('../../models/users.models');
const LotteryRegistration = require('../../models/lottery.models');
const XSMB = require('../../models/XS_MB.models');
const { broadcastComment } = require('../../websocket.js');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const bot = new TelegramBot(token);

const checkRegistrationTime = (region) => {
    const now = moment().tz('Asia/Ho_Chi_Minh');
    const currentTimeInMinutes = now.hours() * 60 + now.minutes();
    const timeLimits = {
        Nam: 16 * 60 + 10,
        Trung: 17 * 60 + 10,
        Bac: 18 * 60 + 10,
        reset: 18 * 60 + 40
    };
    return currentTimeInMinutes > timeLimits.reset || currentTimeInMinutes < timeLimits[region];
};

router.get('/check-limit', authenticate, async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;
        if (!userId || !startDate || !endDate) {
            return res.status(400).json({ message: 'Thiếu userId, startDate hoặc endDate' });
        }
        const registrations = await LotteryRegistration.find({
            userId: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
        });
        res.status(200).json({ registrations });
    } catch (err) {
        console.error('Error in /lottery/check-limit:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi xảy ra' });
    }
});

router.get('/registrations', async (req, res) => {
    try {
        const { region, userId, page = 1, limit = 20 } = req.query;
        const query = {};
        if (region) query.region = region;
        if (userId) {
            try {
                query.userId = new mongoose.Types.ObjectId(userId);
            } catch (err) {
                return res.status(400).json({ message: 'userId không hợp lệ' });
            }
        }
        const registrations = await LotteryRegistration.find(query)
            .populate('userId', 'username fullname level points titles telegramId')
            .sort({ createdAt: -1 })
            .skip((page - 1) * Number(limit))
            .limit(Number(limit))
            .lean();
        const total = await LotteryRegistration.countDocuments(query);
        res.status(200).json({ registrations, total, page, limit });
    } catch (err) {
        console.error('Error in /lottery/registrations:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy danh sách đăng ký' });
    }
});

router.post('/register', authenticate, async (req, res) => {
    try {
        const { region, numbers } = req.body;
        if (!['Nam', 'Trung', 'Bac'].includes(region)) {
            return res.status(400).json({ message: 'Miền không hợp lệ' });
        }
        if (!checkRegistrationTime(region)) {
            return res.status(400).json({ message: `Đăng ký miền ${region} đã đóng. Vui lòng thử lại sau 18:40.` });
        }
        if (numbers.bachThuLo && !/^\d{2}$/.test(numbers.bachThuLo)) {
            return res.status(400).json({ message: 'Bạch thủ lô phải là số 2 chữ số (00-99)' });
        }
        if (numbers.songThuLo.length > 0) {
            if (numbers.songThuLo.length !== 2 || !numbers.songThuLo.every(num => /^\d{2}$/.test(num))) {
                return res.status(400).json({ message: 'Song thủ lô phải gồm 2 số, mỗi số 2 chữ số' });
            }
        }
        if (numbers.threeCL && !/^\d{3}$/.test(numbers.threeCL)) {
            return res.status(400).json({ message: '3CL phải là số 3 chữ số (000-999)' });
        }
        if (numbers.cham && !/^\d{1}$/.test(numbers.cham)) {
            return res.status(400).json({ message: 'Chạm phải là số 1 chữ số (0-9)' });
        }
        const todayStart = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();
        const existingRegistration = await LotteryRegistration.findOne({
            userId: new mongoose.Types.ObjectId(req.user.userId),
            region,
            createdAt: { $gte: todayStart, $lte: todayEnd }
        });
        if (existingRegistration) {
            return res.status(400).json({ message: `Bạn đã đăng ký cho miền ${region} hôm nay. Vui lòng thử lại vào ngày mai.` });
        }
        const registration = new LotteryRegistration({
            userId: new mongoose.Types.ObjectId(req.user.userId),
            region,
            numbers
        });
        await registration.save();
        const populatedRegistration = await LotteryRegistration.findById(registration._id)
            .populate('userId', 'username fullname level points titles telegramId')
            .lean();
        const user = await userModel.findById(new mongoose.Types.ObjectId(req.user.userId));
        if (!user) {
            return res.status(404).json({ message: 'Người dùng không tồn tại' });
        }
        user.points += 10;
        const updatedUser = await user.save();

        console.log('Broadcasting NEW_LOTTERY_REGISTRATION:', {
            registrationId: registration._id,
            region,
            userId: req.user.userId
        });
        broadcastComment({
            type: 'NEW_LOTTERY_REGISTRATION',
            data: populatedRegistration,
            room: 'lotteryFeed'
        });

        res.status(200).json({
            message: 'Đăng ký thành công',
            registration: {
                userId: registration.userId,
                region: registration.region,
                numbers: registration.numbers,
                createdAt: registration.createdAt
            },
            user: {
                id: updatedUser._id,
                points: updatedUser.points,
                titles: updatedUser.titles,
                level: updatedUser.level
            }
        });
    } catch (err) {
        console.error('Error in /lottery/register:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi xảy ra' });
    }
});

router.put('/update/:registrationId', authenticate, async (req, res) => {
    try {
        const { registrationId } = req.params;
        const { numbers } = req.body;

        const registration = await LotteryRegistration.findById(registrationId);
        if (!registration) {
            return res.status(404).json({ message: 'Đăng ký không tồn tại' });
        }

        if (registration.userId.toString() !== req.user.userId) {
            return res.status(403).json({ message: 'Bạn không có quyền chỉnh sửa đăng ký này' });
        }

        if (!checkRegistrationTime(registration.region)) {
            return res.status(400).json({ message: `Thời gian chỉnh sửa cho miền ${registration.region} đã đóng. Vui lòng thử lại sau 18:40.` });
        }

        if (registration.updatedCount && registration.updatedCount >= 1) {
            return res.status(400).json({ message: `Bạn đã chỉnh sửa đăng ký này hôm nay. Chỉ được chỉnh sửa một lần mỗi ngày.` });
        }

        if (numbers.bachThuLo && !/^\d{2}$/.test(numbers.bachThuLo)) {
            return res.status(400).json({ message: 'Bạch thủ lô phải là số 2 chữ số (00-99)' });
        }
        if (numbers.songThuLo.length > 0) {
            if (numbers.songThuLo.length !== 2 || !numbers.songThuLo.every(num => /^\d{2}$/.test(num))) {
                return res.status(400).json({ message: 'Song thủ lô phải gồm 2 số, mỗi số 2 chữ số' });
            }
        }
        if (numbers.threeCL && !/^\d{3}$/.test(numbers.threeCL)) {
            return res.status(400).json({ message: '3CL phải là số 3 chữ số (000-999)' });
        }
        if (numbers.cham && !/^\d{1}$/.test(numbers.cham)) {
            return res.status(400).json({ message: 'Chạm phải là số 1 chữ số (0-9)' });
        }

        registration.numbers = {
            bachThuLo: numbers.bachThuLo || null,
            songThuLo: numbers.songThuLo || [],
            threeCL: numbers.threeCL || null,
            cham: numbers.cham || null
        };
        registration.updatedCount = (registration.updatedCount || 0) + 1;
        registration.updatedAt = new Date();
        await registration.save();

        const populatedRegistration = await LotteryRegistration.findById(registration._id)
            .populate('userId', 'username fullname level points titles telegramId')
            .lean();
        broadcastComment({
            type: 'UPDATE_LOTTERY_REGISTRATION',
            data: populatedRegistration,
            room: 'lotteryFeed'
        });

        res.status(200).json({
            message: 'Chỉnh sửa đăng ký thành công',
            registration: {
                userId: registration.userId,
                region: registration.region,
                numbers: registration.numbers,
                createdAt: registration.createdAt,
                updatedAt: registration.updatedAt,
                updatedCount: registration.updatedCount
            }
        });
    } catch (err) {
        console.error('Error in /lottery/update:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi xảy ra' });
    }
});

// Endpoint lấy kết quả đối chiếu của người dùng
router.get('/check-results', authenticate, async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? moment.tz(date, 'DD-MM-YYYY', 'Asia/Ho_Chi_Minh').startOf('day').toDate()
            : moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();

        const registrations = await LotteryRegistration.find({
            userId: new mongoose.Types.ObjectId(req.user.userId),
            createdAt: {
                $gte: targetDate,
                $lte: moment(targetDate).endOf('day').toDate()
            }
        }).populate('userId', 'username telegramId');

        res.status(200).json({ registrations });
    } catch (err) {
        console.error('Error in /lottery/check-results:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy kết quả đối chiếu' });
    }
});

// Cron job đối chiếu kết quả sau 18:32
cron.schedule('32 18 * * *', async () => {
    console.log('Bắt đầu đối chiếu kết quả XSMB...');
    try {
        const today = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const xsmbResult = await XSMB.findOne({
            station: 'xsmb',
            drawDate: { $gte: today, $lte: moment(today).endOf('day').toDate() }
        }).lean();

        if (!xsmbResult) {
            console.log('Không tìm thấy kết quả XSMB hôm nay.');
            return;
        }

        // Lấy tất cả các giải
        const allPrizes = [
            ...(xsmbResult.specialPrize || []),
            ...(xsmbResult.firstPrize || []),
            ...(xsmbResult.secondPrize || []),
            ...(xsmbResult.threePrizes || []),
            ...(xsmbResult.fourPrizes || []),
            ...(xsmbResult.fivePrizes || []),
            ...(xsmbResult.sixPrizes || []),
            ...(xsmbResult.sevenPrizes || [])
        ].filter(prize => prize && prize !== '...');

        // Lấy tất cả đăng ký hôm nay cho miền Bắc
        const registrations = await LotteryRegistration.find({
            region: 'Bac',
            createdAt: { $gte: today, $lte: moment(today).endOf('day').toDate() }
        }).populate('userId', 'username telegramId');

        for (const registration of registrations) {
            if (registration.result.isChecked) continue;

            let isWin = false;
            const winningNumbers = {
                bachThuLo: false,
                songThuLo: [],
                threeCL: false,
                cham: false
            };
            const matchedPrizes = [];

            // Kiểm tra bạch thủ lô (2 số cuối)
            if (registration.numbers.bachThuLo) {
                const lastTwoDigits = allPrizes.map(prize => prize.slice(-2));
                if (lastTwoDigits.includes(registration.numbers.bachThuLo)) {
                    winningNumbers.bachThuLo = true;
                    isWin = true;
                    matchedPrizes.push(...allPrizes.filter(prize => prize.slice(-2) === registration.numbers.bachThuLo));
                }
            }

            // Kiểm tra song thủ lô (2 số, mỗi số 2 chữ số)
            if (registration.numbers.songThuLo.length > 0) {
                const lastTwoDigits = allPrizes.map(prize => prize.slice(-2));
                registration.numbers.songThuLo.forEach(num => {
                    if (lastTwoDigits.includes(num)) {
                        winningNumbers.songThuLo.push(num);
                        isWin = true;
                        matchedPrizes.push(...allPrizes.filter(prize => prize.slice(-2) === num));
                    }
                });
            }

            // Kiểm tra 3CL (3 số cuối)
            if (registration.numbers.threeCL) {
                const lastThreeDigits = allPrizes.map(prize => prize.slice(-3));
                if (lastThreeDigits.includes(registration.numbers.threeCL)) {
                    winningNumbers.threeCL = true;
                    isWin = true;
                    matchedPrizes.push(...allPrizes.filter(prize => prize.slice(-3) === registration.numbers.threeCL));
                }
            }

            // Kiểm tra chạm (2 số cuối của giải đặc biệt chứa số chạm)
            if (registration.numbers.cham && xsmbResult.specialPrize && xsmbResult.specialPrize[0]) {
                const specialLastTwo = xsmbResult.specialPrize[0].slice(-2);
                if (specialLastTwo.includes(registration.numbers.cham)) {
                    winningNumbers.cham = true;
                    isWin = true;
                    matchedPrizes.push(xsmbResult.specialPrize[0]);
                }
            }

            // Cập nhật kết quả
            registration.result = {
                isChecked: true,
                isWin,
                winningNumbers,
                matchedPrizes,
                checkedAt: new Date()
            };
            await registration.save();

            // Gửi thông báo qua Telegram
            const user = registration.userId;
            if (user.telegramId) {
                const message = isWin
                    ? `Chúc mừng ${user.username}! Bạn đã trúng số miền Bắc ngày ${moment(today).format('DD-MM-YYYY')}:\n` +
                    (winningNumbers.bachThuLo ? `Bạch thủ lô: ${registration.numbers.bachThuLo}\n` : '') +
                    (winningNumbers.songThuLo.length > 0 ? `Song thủ lô: ${winningNumbers.songThuLo.join(', ')}\n` : '') +
                    (winningNumbers.threeCL ? `3CL: ${registration.numbers.threeCL}\n` : '') +
                    (winningNumbers.cham ? `Chạm: ${registration.numbers.cham}\n` : '') +
                    `Các giải trúng: ${matchedPrizes.join(', ')}`
                    : `Rất tiếc ${user.username}, bạn không trúng số miền Bắc ngày ${moment(today).format('DD-MM-YYYY')}.`;
                try {
                    await bot.sendMessage(user.telegramId, message);
                } catch (err) {
                    console.error(`Lỗi gửi thông báo Telegram cho ${user.username}:`, err.message);
                }
            }
        }

        console.log('Hoàn tất đối chiếu kết quả XSMB.');
    } catch (err) {
        console.error('Lỗi khi đối chiếu kết quả XSMB:', err.message);
    }
});

module.exports = router;