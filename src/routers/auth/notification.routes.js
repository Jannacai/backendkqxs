
"use strict";

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticate } = require('../auth/auth.routes');
const Notification = require('../../models/notification.models');
const { broadcastComment } = require('../../websocket.js');

// Đánh dấu một thông báo là đã đọc
router.post('/:id/read', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID thông báo không hợp lệ' });
        }

        const notification = await Notification.findById(id);
        if (!notification) {
            return res.status(404).json({ error: 'Không tìm thấy thông báo' });
        }

        if (notification.userId.toString() !== req.user.userId) {
            return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa thông báo này' });
        }

        notification.isRead = true;
        await notification.save();

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ message: 'Đánh dấu thông báo đã đọc thành công', notification });
    } catch (err) {
        console.error('Error in /notifications/:id/read:', err.message);
        res.status(500).json({ error: err.message || 'Đã có lỗi khi đánh dấu thông báo đã đọc' });
    }
});

// Đánh dấu tất cả thông báo là đã đọc
router.post('/read-all', authenticate, async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: new mongoose.Types.ObjectId(req.user.userId), isRead: false },
            { isRead: true }
        );

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ message: 'Đã đánh dấu tất cả thông báo là đã đọc' });
    } catch (err) {
        console.error('Error in /notifications/read-all:', err.message);
        res.status(500).json({ error: err.message || 'Đã có lỗi khi đánh dấu tất cả thông báo đã đọc' });
    }
});

// Xóa một thông báo
router.delete('/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'ID thông báo không hợp lệ' });
        }

        const notification = await Notification.findById(id);
        if (!notification) {
            return res.status(404).json({ error: 'Không tìm thấy thông báo' });
        }

        if (notification.userId.toString() !== req.user.userId) {
            return res.status(403).json({ error: 'Bạn không có quyền xóa thông báo này' });
        }

        await Notification.deleteOne({ _id: id });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ message: 'Xóa thông báo thành công' });
    } catch (err) {
        console.error('Error in /notifications/:id:', err.message);
        res.status(500).json({ error: err.message || 'Đã có lỗi khi xóa thông báo' });
    }
});

// Lấy danh sách thông báo theo loại
router.get('/', authenticate, async (req, res) => {
    try {
        const { type, page = 1, limit = 20 } = req.query;
        const query = { userId: new mongoose.Types.ObjectId(req.user.userId) };
        if (type) {
            query.type = Array.isArray(type) ? { $in: type } : type;
        }

        const notifications = await Notification.find(query)
            .populate('userId', 'username fullname img titles points winCount')
            .populate('eventId', 'title')
            .sort({ createdAt: -1 })
            .skip((page - 1) * Number(limit))
            .limit(Number(limit))
            .lean();

        // Chuyển eventId thành chuỗi
        const formattedNotifications = notifications.map(notification => ({
            ...notification,
            eventId: notification.eventId?._id ? notification.eventId._id.toString() : notification.eventId
        }));

        const total = await Notification.countDocuments(query);

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ notifications: formattedNotifications, total, page, limit });
    } catch (err) {
        console.error('Error in /notifications:', err.message);
        res.status(500).json({ error: err.message || 'Đã có lỗi khi lấy danh sách thông báo' });
    }
});

// Tạo thông báo phát thưởng
router.post('/reward', authenticate, async (req, res) => {
    try {
        const { userId, pointsAwarded, eventId, eventTitle } = req.body;
        if (!userId || !pointsAwarded || pointsAwarded <= 0 || !eventTitle) {
            return res.status(400).json({ error: 'Cần cung cấp userId, pointsAwarded, và eventTitle hợp lệ' });
        }

        const notification = new Notification({
            userId: new mongoose.Types.ObjectId(userId),
            type: 'USER_REWARDED',
            content: `Bạn đã được phát thưởng ${ pointsAwarded } điểm cho sự kiện ${ eventTitle } !`,
            isRead: false,
            createdAt: new Date(),
            eventId: eventId ? eventId.toString() : null
        });

        await notification.save();

        const populatedNotification = await Notification.findById(notification._id)
            .populate('userId', 'username fullname img titles points winCount')
            .populate('eventId', 'title')
            .lean();

        // Chuyển eventId thành chuỗi trong response
        const formattedNotification = {
            ...populatedNotification,
            eventId: populatedNotification.eventId?._id ? populatedNotification.eventId._id.toString() : populatedNotification.eventId
        };

        // Gửi thông báo qua WebSocket đến phòng riêng của người dùng
        broadcastComment({
            type: 'USER_REWARDED',
            data: {
                notificationId: populatedNotification._id.toString(),
                userId: populatedNotification.userId._id.toString(),
                username: populatedNotification.userId.username,
                fullname: populatedNotification.userId.fullname,
                img: populatedNotification.userId.img,
                titles: populatedNotification.userId.titles,
                points: populatedNotification.userId.points,
                winCount: populatedNotification.userId.winCount,
                pointsAwarded,
                eventTitle,
                eventId: eventId ? eventId.toString() : null,
                awardedAt: populatedNotification.createdAt
            },
            room: `user:${ userId } ` // Gửi đến phòng riêng của người dùng
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ message: 'Tạo thông báo phát thưởng thành công', notification: formattedNotification });
    } catch (err) {
        console.error('Error in /notifications/reward:', err.message);
        res.status(500).json({ error: err.message || 'Đã có lỗi khi tạo thông báo phát thưởng' });
    }
});

module.exports = router;
