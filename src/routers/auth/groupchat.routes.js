"use strict";

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { authenticate } = require('./auth.routes');
const Chat = require('../../models/groupchat.models');
const User = require('../../models/users.models');
const { broadcastComment } = require('../../websocket');

router.get('/', async (req, res) => {
    try {
        const messages = await Chat.find({ isPrivate: false })
            .populate('userId', 'username fullname img role titles points level winCount')
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ messages });
    } catch (err) {
        console.error('Error in GET /chat:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy danh sách tin nhắn' });
    }
});

router.get('/private/:roomId', authenticate, async (req, res) => {
    try {
        const { roomId } = req.params;
        const [userId1, userId2] = roomId.split('-').map(id => new mongoose.Types.ObjectId(id));
        const messages = await Chat.find({
            isPrivate: true,
            $or: [
                { userId: userId1, receiverId: userId2 },
                { userId: userId2, receiverId: userId1 }
            ]
        })
            .populate('userId', 'username fullname img role titles points level winCount')
            .sort({ createdAt: -1 })
            .lean();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ messages });
    } catch (err) {
        console.error('Error in GET /chat/private/:roomId:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy tin nhắn riêng' });
    }
});

router.post('/', authenticate, async (req, res) => {
    try {
        const { content, receiverId } = req.body;
        if (!content || content.trim().length === 0) {
            return res.status(400).json({ message: 'Nội dung tin nhắn là bắt buộc' });
        }
        // Nếu có receiverId (tin nhắn riêng)
        if (receiverId) {
            console.log('Processing private message:', {
                senderId: req.user.userId,
                senderRole: req.user.role,
                receiverId,
            });
            // Kiểm tra vai trò của người gửi
            const isSenderAdmin = req.user.role === 'admin' || req.user.role === 'ADMIN';
            if (!isSenderAdmin) {
                // Người gửi là user, kiểm tra receiverId phải là admin
                const receiver = await User.findById(receiverId);
                if (!receiver) {
                    return res.status(404).json({ message: 'Người nhận không tồn tại' });
                }
                console.log('Receiver info:', { receiverId, receiverRole: receiver.role });
                const isReceiverAdmin = receiver.role === 'admin' || receiver.role === 'ADMIN';
                if (!isReceiverAdmin) {
                    return res.status(403).json({ message: 'Chỉ được phép gửi tin nhắn riêng tới admin' });
                }
            }
            // Nếu người gửi là admin, cho phép gửi tới bất kỳ ai
        }
        const message = new Chat({
            userId: new mongoose.Types.ObjectId(req.user.userId),
            receiverId: receiverId ? new mongoose.Types.ObjectId(receiverId) : null,
            content,
            createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate(),
            isPrivate: !!receiverId,
        });
        await message.save();
        const populatedMessage = await Chat.findById(message._id)
            .populate('userId', 'username fullname img role titles points level winCount')
            .lean();
        const roomId = receiverId ? [req.user.userId, receiverId].sort().join('-') : 'chat';
        console.log('Broadcasting message:', {
            type: receiverId ? 'PRIVATE_MESSAGE' : 'NEW_MESSAGE',
            roomId,
            senderId: req.user.userId,
            receiverId
        });
        // Phát sự kiện tới phòng riêng của cả người gửi và người nhận
        broadcastComment({
            type: receiverId ? 'PRIVATE_MESSAGE' : 'NEW_MESSAGE',
            data: { ...populatedMessage, roomId },
            room: receiverId ? null : 'chat', // Chỉ phát đến phòng 'chat' nếu là tin nhắn công khai
            senderId: req.user.userId,
            receiverId
        });
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ message: 'Gửi tin nhắn thành công', chat: populatedMessage });
    } catch (err) {
        console.error('Error in POST /chat:', err.message);
        res.status(500).json({ message: err.message || 'Đã có lỗi khi gửi tin nhắn' });
    }
});

module.exports = router;