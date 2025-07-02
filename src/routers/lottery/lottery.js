"use strict";

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { authenticate } = require('../auth/auth.routes');
const userModel = require('../../models/users.models');
const LotteryRegistration = require('../../models/lottery.models');
const XSMB = require('../../models/XS_MB.models');
const XSMN = require('../../models/XS_MN.models');
const XSMT = require('../../models/XS_MT.models');
const { broadcastComment } = require('../../websocket.js');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const bot = new TelegramBot(token);

process.env.TZ = 'Asia/Ho_Chi_Minh';

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

const checkLotteryResults = async (region, Model) => {
    console.log(`Bắt đầu đối chiếu kết quả ${region}...`);
    try {
        const today = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();
        console.log(`Cron job date range for ${region}:`, {
            today: today.toISOString(),
            todayEnd: todayEnd.toISOString()
        });

        const result = await Model.findOne({
            station: region.toLowerCase(),
            drawDate: { $gte: today, $lte: todayEnd }
        }).lean();

        if (!result) {
            console.error(`Không tìm thấy kết quả ${region} cho ngày:`, today.toISOString());
            broadcastComment({
                type: 'LOTTERY_RESULT_ERROR',
                data: { message: `Không tìm thấy kết quả ${region} cho ngày hiện tại` },
                room: 'lotteryFeed'
            });
            return;
        }

        console.log(`${region} result found:`, {
            drawDate: result.drawDate,
            specialPrize: result.specialPrize,
            firstPrize: result.firstPrize
        });

        const allPrizes = [
            ...(result.specialPrize || []),
            ...(result.firstPrize || []),
            ...(result.secondPrize || []),
            ...(result.threePrizes || []),
            ...(result.fourPrizes || []),
            ...(result.fivePrizes || []),
            ...(result.sixPrizes || []),
            ...(result.sevenPrizes || [])
        ].filter(prize => prize && prize !== '...');

        const registrations = await LotteryRegistration.find({
            region,
            createdAt: { $gte: today, $lte: todayEnd }
        }).populate('userId', 'username telegramId winCount');

        console.log(`Registrations to check for ${region}:`, registrations.length);

        for (const registration of registrations) {
            if (registration.result.isChecked) {
                console.log('Skipping checked registration:', registration._id);
                continue;
            }

            let isWin = false;
            const winningNumbers = {
                bachThuLo: false,
                songThuLo: [],
                threeCL: false,
                cham: false
            };
            const matchedPrizes = [];

            if (registration.numbers.bachThuLo) {
                const lastTwoDigits = allPrizes.map(prize => prize.slice(-2));
                if (lastTwoDigits.includes(registration.numbers.bachThuLo)) {
                    winningNumbers.bachThuLo = true;
                    isWin = true;
                    matchedPrizes.push(...allPrizes.filter(prize => prize.slice(-2) === registration.numbers.bachThuLo));
                }
            }

            if (registration.numbers.songThuLo && registration.numbers.songThuLo.length > 0) {
                const lastTwoDigits = allPrizes.map(prize => prize.slice(-2));
                const wins = registration.numbers.songThuLo.filter(num => lastTwoDigits.includes(num));
                if (wins.length > 0) {
                    winningNumbers.songThuLo = wins;
                    isWin = true;
                    matchedPrizes.push(...allPrizes.filter(prize => wins.includes(prize.slice(-2))));
                }
            }

            if (registration.numbers.threeCL) {
                const lastThreeDigits = allPrizes.map(prize => prize.slice(-3));
                if (lastThreeDigits.includes(registration.numbers.threeCL)) {
                    winningNumbers.threeCL = true;
                    isWin = true;
                    matchedPrizes.push(...allPrizes.filter(prize => prize.slice(-3) === registration.numbers.threeCL));
                }
            }

            if (registration.numbers.cham && result.specialPrize && result.specialPrize[0]) {
                const specialLastTwo = result.specialPrize[0].slice(-2);
                if (specialLastTwo.includes(registration.numbers.cham)) {
                    winningNumbers.cham = true;
                    isWin = true;
                    matchedPrizes.push(result.specialPrize[0]);
                }
            }

            registration.result = {
                isChecked: true,
                isWin,
                winningNumbers,
                matchedPrizes,
                checkedAt: moment().tz('Asia/Ho_Chi_Minh').toDate()
            };
            await registration.save();

            const populatedRegistration = await LotteryRegistration.findById(registration._id)
                .populate('userId', 'username fullname level points titles telegramId winCount')
                .lean();

            console.log('Updated registration:', {
                id: registration._id,
                userId: registration.userId,
                result: registration.result
            });

            broadcastComment({
                type: 'LOTTERY_RESULT_CHECKED',
                data: populatedRegistration,
                room: 'lotteryFeed'
            });

            if (isWin) {
                const user = await userModel.findById(registration.userId);
                user.points += 50;
                user.winCount = (user.winCount || 0) + 1;
                const updatedUser = await user.save();
                broadcastComment({
                    type: 'USER_UPDATED',
                    data: {
                        _id: updatedUser._id,
                        points: updatedUser.points,
                        titles: updatedUser.titles,
                        winCount: updatedUser.winCount
                    },
                    room: 'leaderboard'
                });
            }

            const user = registration.userId;
            if (user.telegramId) {
                const message = isWin
                    ? `Chúc mừng ${user.username}! Bạn đã trúng số miền ${region} ngày ${moment(today).format('DD-MM-YYYY')}:\n` +
                    (winningNumbers.bachThuLo ? `Bạch thủ lô: ${registration.numbers.bachThuLo}\n` : '') +
                    (winningNumbers.songThuLo.length > 0 ? `Song thủ lô: ${winningNumbers.songThuLo.join(', ')}\n` : '') +
                    (winningNumbers.threeCL ? `3CL: ${registration.numbers.threeCL}\n` : '') +
                    (winningNumbers.cham ? `Chạm: ${registration.numbers.cham}\n` : '') +
                    `Các giải trúng: ${matchedPrizes.join(', ')}`
                    : `Rất tiếc ${user.username}, bạn không trúng số miền ${region} ngày ${moment(today).format('DD-MM-YYYY')}.`;
                try {
                    await bot.sendMessage(user.telegramId, message);
                } catch (err) {
                    console.error(`Lỗi gửi thông báo Telegram cho ${user.username}:`, err.message);
                }
            }
        }

        console.log(`Hoàn tất đối chiếu kết quả ${region}.`);
    } catch (err) {
        console.error(`Lỗi khi đối chiếu kết quả ${region}:`, err.message);
        broadcastComment({
            type: 'LOTTERY_RESULT_ERROR',
            data: { message: `Lỗi khi đối chiếu kết quả ${region}` },
            room: 'lotteryFeed'
        });
    }
};

router.get('/awards', async (req, res) => {
    try {
        console.log('Fetching awards with params:', req.query);
        const today = moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();
        const todayEnd = moment().tz('Asia/Ho_Chi_Minh').endOf('day').toDate();

        const winners = await LotteryRegistration.find({
            'result.isWin': true,
            createdAt: { $gte: today, $lte: todayEnd }
        })
            .populate('userId', 'username fullname img titles points level winCount')
            .lean();

        console.log('Winners fetched:', winners.length);

        const formattedWinners = winners.map(winner => {
            const user = winner.userId;
            const titleThresholds = [
                { title: 'Tân thủ', minPoints: 0, maxPoints: 100 },
                { title: 'Học Giả', minPoints: 101, maxPoints: 500 },
                { title: 'Chuyên Gia', minPoints: 501, maxPoints: 1000 },
                { title: 'Thần Số Học', minPoints: 1001, maxPoints: 2000 },
                { title: 'Thần Chốt Số', minPoints: 2001, maxPoints: 5000 },
            ];
            const highestTitle = titleThresholds
                .find(threshold => user.points >= threshold.minPoints && user.points <= threshold.maxPoints)
                ?.title || 'Tân thủ';

            return {
                _id: user._id,
                fullname: user.fullname,
                img: user.img,
                titles: user.titles,
                points: user.points,
                level: user.level,
                highestTitle
            };
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json(formattedWinners);
    } catch (err) {
        console.error('Error in /lottery/awards:', err.message);
        res.status(500).json({ message: err.message || 'Không thể tải danh sách người trúng giải' });
    }
});

router.get('/check-limit', authenticate, async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query;
        if (!userId || !startDate || !endDate) {
            return res.status(400).json({ message: 'Thiếu userId, startDate hoặc endDate' });
        }
        console.log('Check-limit query:', { userId, startDate, endDate });
        const registrations = await LotteryRegistration.find({
            userId: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
        });
        console.log('Check-limit response:', registrations);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
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
            .populate('userId', 'username fullname level points titles telegramId winCount')
            .sort({ createdAt: -1 })
            .skip((page - 1) * Number(limit))
            .limit(Number(limit))
            .lean();
        const total = await LotteryRegistration.countDocuments(query);
        console.log('Registrations fetched:', registrations.length, 'Total:', total);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ registrations, total, page, limit });
    } catch (err) {
        console.error('Error in /lottery/registrations:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy danh sách đăng ký' });
    }
});

router.get('/results', authenticate, async (req, res) => {
    try {
        const { region, date } = req.query;
        if (!region || !['Nam', 'Trung', 'Bac'].includes(region)) {
            return res.status(400).json({ message: 'Miền không hợp lệ' });
        }
        const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
            ? moment.tz(date, 'YYYY-MM-DD', 'Asia/Ho_Chi_Minh').startOf('day').toDate()
            : moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();

        const modelMap = {
            Bac: XSMB,
            Nam: XSMN,
            Trung: XSMT
        };

        const Model = modelMap[region];
        if (!Model) {
            return res.status(400).json({ message: `Không hỗ trợ kết quả cho miền ${region}` });
        }

        const result = await Model.findOne({
            drawDate: {
                $gte: targetDate,
                $lte: moment(targetDate).endOf('day').toDate()
            }
        }).lean();

        if (!result) {
            return res.status(404).json({ message: `Không tìm thấy kết quả xổ số cho miền ${region} ngày ${moment(targetDate).format('DD-MM-YYYY')}` });
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({
            results: {
                giaiDacBiet: result.specialPrize || [],
                firstPrize: result.firstPrize || [],
                secondPrize: result.secondPrize || [],
                threePrizes: result.threePrizes || [],
                fourPrizes: result.fourPrizes || [],
                fivePrizes: result.fivePrizes || [],
                sixPrizes: result.sixPrizes || [],
                sevenPrizes: result.sevenPrizes || [],
                drawDate: result.drawDate
            }
        });
    } catch (err) {
        console.error('Error in /lottery/results:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy kết quả xổ số' });
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
            numbers,
            result: {
                isChecked: false,
                isWin: false,
                winningNumbers: {
                    bachThuLo: false,
                    songThuLo: [],
                    threeCL: false,
                    cham: false
                },
                matchedPrizes: [],
                checkedAt: null
            }
        });
        await registration.save();
        console.log('Saved registration:', {
            id: registration._id,
            userId: registration.userId,
            createdAt: registration.createdAt,
            region
        });
        const populatedRegistration = await LotteryRegistration.findById(registration._id)
            .populate('userId', 'username fullname level points titles telegramId winCount')
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
        broadcastComment({
            type: 'USER_UPDATED',
            data: {
                _id: updatedUser._id,
                points: updatedUser.points,
                titles: updatedUser.titles,
                winCount: updatedUser.winCount
            },
            room: 'leaderboard'
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({
            message: 'Đăng ký thành công',
            registration: {
                userId: registration.userId,
                region: registration.region,
                numbers: registration.numbers,
                createdAt: registration.createdAt,
                result: registration.result
            },
            user: {
                id: updatedUser._id,
                points: updatedUser.points,
                titles: updatedUser.titles,
                level: updatedUser.level,
                winCount: updatedUser.winCount
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
        await registration.save();

        const populatedRegistration = await LotteryRegistration.findById(registration._id)
            .populate('userId', 'username fullname level points titles telegramId winCount')
            .lean();
        broadcastComment({
            type: 'UPDATE_LOTTERY_REGISTRATION',
            data: populatedRegistration,
            room: 'lotteryFeed'
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({
            message: 'Chỉnh sửa đăng ký thành công',
            registration: {
                userId: registration.userId,
                region: registration.region,
                numbers: registration.numbers,
                createdAt: registration.createdAt,
                updatedAt: registration.updatedAt,
                updatedCount: registration.updatedCount,
                result: registration.result
            }
        });
    } catch (err) {
        console.error('Error in /lottery/update:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi xảy ra' });
    }
});

router.get('/check-results', authenticate, async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date && /^\d{2}-\d{2}-\d{4}$/.test(date)
            ? moment.tz(date, 'DD-MM-YYYY', 'Asia/Ho_Chi_Minh').startOf('day').toDate()
            : moment().tz('Asia/Ho_Chi_Minh').startOf('day').toDate();

        console.log('Check-results query:', {
            userId: req.user.userId,
            targetDate: targetDate.toISOString(),
            endDate: moment(targetDate).endOf('day').toDate().toISOString()
        });

        const registrations = await LotteryRegistration.find({
            userId: new mongoose.Types.ObjectId(req.user.userId),
            createdAt: {
                $gte: targetDate,
                $lte: moment(targetDate).endOf('day').toDate()
            }
        }).populate('userId', 'username telegramId winCount');

        console.log('Check-results response:', registrations.map(r => ({
            id: r._id,
            region: r.region,
            createdAt: r.createdAt,
            result: r.result
        })));

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ registrations });
    } catch (err) {
        console.error('Error in /lottery/check-results:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy kết quả đối chiếu' });
    }
});

cron.schedule('38 16 * * *', async () => {
    await checkLotteryResults('Nam', XSMN);
});

cron.schedule('32 17 * * *', async () => {
    await checkLotteryResults('Trung', XSMT);
});

cron.schedule('32 18 * * *', async () => {
    await checkLotteryResults('Bac', XSMB);
});

module.exports = router;