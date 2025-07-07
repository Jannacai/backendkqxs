"use strict";

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { authenticate } = require('../auth/auth.routes');
const Event = require('../../models/event.models');
const LotteryRegistration = require('../../models/lottery.models');
const Notification = require('../../models/notification.models');
const User = require('../../models/users.models');
const { broadcastComment } = require('../../websocket');

const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: "Chỉ admin mới có quyền truy cập" });
    }
    next();
};

router.get('/', async (req, res) => {
    try {
        const { type, page = 1, limit = 10 } = req.query;
        const query = type ? { type } : {};
        const events = await Event.find(query)
            .populate('createdBy', 'username fullname img')
            .populate('comments.userId', 'username fullname img')
            .sort({ createdAt: -1 })
            .skip((page - 1) * Number(limit))
            .limit(Number(limit))
            .lean();

        const eventIds = events.map(event => event._id);
        const registrationCounts = await LotteryRegistration.aggregate([
            { $match: { eventId: { $in: eventIds }, isEvent: false } },
            { $group: { _id: "$eventId", count: { $sum: 1 } } }
        ]);

        const eventsWithCounts = events.map(event => ({
            ...event,
            registrationCount: registrationCounts.find(reg => reg._id.toString() === event._id.toString())?.count || 0,
            viewCount: event.viewCount || 0
        }));

        const total = await Event.countDocuments(query);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ events: eventsWithCounts, total, page, limit });
    } catch (err) {
        console.error('Error in GET /events:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy danh sách' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'ID sự kiện không hợp lệ' });
        }
        const event = await Event.findByIdAndUpdate(
            id,
            { $inc: { viewCount: 1 } },
            { new: true }
        )
            .populate('createdBy', 'username fullname img')
            .populate('comments.userId', 'username fullname img')
            .lean();
        if (!event) {
            return res.status(404).json({ message: 'Không tìm thấy event/tin hot' });
        }
        const registrationCount = await LotteryRegistration.countDocuments({
            eventId: event._id,
            isEvent: false
        });
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ ...event, registrationCount, viewCount: event.viewCount || 0 });
    } catch (err) {
        console.error('Error in GET /events/:id:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy chi tiết' });
    }
});

router.post('/', authenticate, isAdmin, async (req, res) => {
    try {
        const { title, content, type, lotteryFields, startTime, endTime, rules, rewards, scoringMethod, notes } = req.body;
        if (!['event', 'hot_news'].includes(type)) {
            return res.status(400).json({ message: 'Loại không hợp lệ' });
        }
        if (!title || !content) {
            return res.status(400).json({ message: 'Tiêu đề và nội dung là bắt buộc' });
        }
        if (startTime && endTime && moment(endTime).isBefore(startTime)) {
            return res.status(400).json({ message: 'Thời gian kết thúc phải sau thời gian bắt đầu' });
        }

        const eventData = {
            title,
            content,
            type,
            createdBy: new mongoose.Types.ObjectId(req.user.userId),
            lotteryFields: {
                bachThuLo: !!lotteryFields?.bachThuLo,
                songThuLo: !!lotteryFields?.songThuLo,
                threeCL: !!lotteryFields?.threeCL,
                cham: !!lotteryFields?.cham
            },
            viewCount: 0,
            createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate(),
            updatedAt: moment.tz('Asia/Ho_Chi_Minh').toDate()
        };

        // Thêm các trường không bắt buộc nếu được cung cấp và không rỗng
        if (startTime) eventData.startTime = moment.tz(startTime, 'Asia/Ho_Chi_Minh').toDate();
        if (endTime) eventData.endTime = moment.tz(endTime, 'Asia/Ho_Chi_Minh').toDate();
        if (rules?.trim()) eventData.rules = rules.trim();
        if (rewards?.trim()) eventData.rewards = rewards.trim();
        if (scoringMethod?.trim()) eventData.scoringMethod = scoringMethod.trim();
        if (notes?.trim()) eventData.notes = notes.trim();

        const event = new Event(eventData);
        await event.save();
        const populatedEvent = await Event.findById(event._id)
            .populate('createdBy', 'username fullname img')
            .lean();

        // Tạo document LotteryRegistration cho thông báo sự kiện
        const eventNotification = new LotteryRegistration({
            userId: new mongoose.Types.ObjectId(req.user.userId),
            eventId: event._id.toString(),
            isEvent: true,
            title: populatedEvent.title,
            type: populatedEvent.type,
            region: '',
            numbers: {},
            createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate()
        });
        await eventNotification.save();

        // Tạo thông báo NEW_EVENT cho tất cả người dùng (bao gồm cả admin)
        const users = await User.find().select('_id role').lean();
        const notificationPromises = users.map(user => {
            return new Notification({
                userId: user._id,
                type: 'NEW_EVENT',
                content: `HOT!!! ${populatedEvent.type === 'event' ? 'sự kiện' : 'tin hot'}: ${populatedEvent.title} `,
                isRead: false,
                createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate(),
                eventId: event._id.toString()
            }).save();
        });
        const notifications = await Promise.all(notificationPromises);

        // Gửi thông báo NEW_EVENT đến phòng riêng của từng người dùng
        notifications.forEach(notification => {
            console.log(`Broadcasting NEW_EVENT to user:${notification.userId} (role: ${users.find(u => u._id.toString() === notification.userId.toString())?.role})`);
            broadcastComment({
                type: 'NEW_EVENT',
                data: {
                    notificationId: notification._id.toString(),
                    userId: notification.userId.toString(),
                    type: 'NEW_EVENT',
                    content: notification.content,
                    isRead: false,
                    createdAt: notification.createdAt,
                    eventId: event._id.toString(),
                    createdBy: populatedEvent.createdBy
                },
                room: `user:${notification.userId} `
            });
        });

        // Gửi thông báo tới lotteryFeed
        const populatedNotification = await LotteryRegistration.findById(eventNotification._id)
            .populate('userId', 'username fullname img titles points winCount')
            .lean();
        broadcastComment({
            type: 'NEW_EVENT_NOTIFICATION',
            data: {
                ...populatedNotification,
                eventId: populatedNotification.eventId.toString()
            },
            room: 'lotteryFeed'
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(201).json({
            message: 'Tạo sự kiện thành công',
            event: populatedEvent
        });
    } catch (err) {
        console.error('Error in POST /events:', err.message);
        res.status(500).json({ error: err.message || 'Đã có lỗi khi tạo18 tạo sự kiện' });
    }
});

router.post('/:id/comments', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'ID sự kiện không hợp lệ' });
        }
        const { content } = req.body;
        if (!content || content.trim().length === 0) {
            return res.status(400).json({ message: 'Nội dung bình luận là bắt buộc' });
        }
        const event = await Event.findById(id);
        if (!event) {
            return res.status(404).json({ message: 'Không tìm thấy event/tin hot' });
        }
        event.comments.push({
            userId: new mongoose.Types.ObjectId(req.user.userId),
            content
        });
        await event.save();
        const populatedEvent = await Event.findById(id)
            .populate('createdBy', 'username fullname img')
            .populate('comments.userId', 'username fullname img')
            .lean();
        broadcastComment({
            type: 'NEW_COMMENT',
            data: populatedEvent,
            room: `event:${id} `
        });
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ message: 'Bình luận thành công', event: populatedEvent });
    } catch (err) {
        console.error('Error in POST /events/:id/comments:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi thêm bình luận' });
    }
});

module.exports = router;