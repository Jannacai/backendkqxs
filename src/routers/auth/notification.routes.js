"use strict";

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticate } = require('../auth/auth.routes');
const Notification = require('../../models/notification.models');

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

module.exports = router;