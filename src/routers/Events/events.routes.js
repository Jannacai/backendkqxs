// "use strict";

// const express = require('express');
// const router = express.Router();
// const mongoose = require('mongoose');
// const moment = require('moment-timezone');
// const { authenticate } = require('../auth/auth.routes');
// const Event = require('../../models/event.models');
// const LotteryRegistration = require('../../models/lottery.models');
// const Notification = require('../../models/notification.models');
// const User = require('../../models/users.models');
// const { broadcastComment } = require('../../websocket');

// const isAdmin = (req, res, next) => {
//     if (!req.user || req.user.role !== 'ADMIN') {
//         return res.status(403).json({ error: "Chỉ admin mới có quyền truy cập" });
//     }
//     next();
// };

// router.get('/', async (req, res) => {
//     try {
//         const { type, page = 1, limit = 20 } = req.query;
//         const query = type ? { type } : {};
//         const events = await Event.find(query)
//             .populate('createdBy', 'username fullname img')
//             .populate('comments.userId', 'username fullname img')
//             .sort({ createdAt: -1 })
//             .skip((page - 1) * Number(limit))
//             .limit(Number(limit))
//             .lean();

//         const eventIds = events.map(event => event._id);
//         const registrationCounts = await LotteryRegistration.aggregate([
//             { $match: { eventId: { $in: eventIds }, isEvent: false } },
//             { $group: { _id: "$eventId", count: { $sum: 1 } } }
//         ]);

//         const eventsWithCounts = events.map(event => {
//             const commentCount = event.comments.length +
//                 event.comments.reduce((total, comment) => total + (comment.replies?.length || 0), 0);
//             return {
//                 ...event,
//                 registrationCount: registrationCounts.find(reg => reg._id.toString() === event._id.toString())?.count || 0,
//                 viewCount: event.viewCount || 0,
//                 commentCount
//             };
//         });

//         const total = await Event.countDocuments(query);
//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ events: eventsWithCounts, total, page, limit });
//     } catch (err) {
//         console.error('Error in GET /events:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy danh sách' });
//     }
// });

// router.get('/:id', async (req, res) => {
//     try {
//         const { id } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id)) {
//             return res.status(400).json({ message: 'ID sự kiện không hợp lệ' });
//         }
//         const event = await Event.findByIdAndUpdate(
//             id,
//             { $inc: { viewCount: 1 } },
//             { new: true }
//         )
//             .populate('createdBy', 'username fullname img')
//             .populate('comments.userId', 'username fullname img')
//             .lean();
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy event/tin hot/thảo luận' });
//         }
//         const registrationCount = await LotteryRegistration.countDocuments({
//             eventId: event._id,
//             isEvent: false
//         });
//         const commentCount = event.comments.length +
//             event.comments.reduce((total, comment) => total + (comment.replies?.length || 0), 0);
//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ ...event, registrationCount, viewCount: event.viewCount || 0, commentCount });
//     } catch (err) {
//         console.error('Error in GET /events/:id:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi lấy chi tiết' });
//     }
// });

// router.post('/', authenticate, async (req, res, next) => {
//     try {
//         const { title, content, type, lotteryFields, startTime, endTime, rules, rewards, scoringMethod, notes } = req.body;

//         if (['event', 'hot_news'].includes(type) && (!req.user || req.user.role !== 'ADMIN')) {
//             return res.status(403).json({ error: "Chỉ admin mới có quyền đăng sự kiện hoặc tin hot" });
//         }

//         if (!['event', 'hot_news', 'discussion'].includes(type)) {
//             return res.status(400).json({ message: 'Loại không hợp lệ' });
//         }
//         if (!title || !content) {
//             return res.status(400).json({ message: 'Tiêu đề và nội dung là bắt buộc' });
//         }
//         if (type !== 'discussion' && startTime && endTime && moment(endTime).isBefore(startTime)) {
//             return res.status(400).json({ message: 'Thời gian kết thúc phải sau thời gian bắt đầu' });
//         }

//         const eventData = {
//             title,
//             content,
//             type,
//             createdBy: new mongoose.Types.ObjectId(req.user.userId),
//             lotteryFields: type === 'event' ? {
//                 bachThuLo: !!lotteryFields?.bachThuLo,
//                 songThuLo: !!lotteryFields?.songThuLo,
//                 threeCL: !!lotteryFields?.threeCL,
//                 cham: !!lotteryFields?.cham
//             } : {
//                 bachThuLo: false,
//                 songThuLo: false,
//                 threeCL: false,
//                 cham: false
//             },
//             viewCount: 0,
//             createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate(),
//             updatedAt: moment.tz('Asia/Ho_Chi_Minh').toDate()
//         };

//         if (type !== 'discussion') {
//             if (startTime) eventData.startTime = moment.tz(startTime, 'Asia/Ho_Chi_Minh').toDate();
//             if (endTime) eventData.endTime = moment.tz(endTime, 'Asia/Ho_Chi_Minh').toDate();
//             if (rules?.trim()) eventData.rules = rules.trim();
//             if (rewards?.trim()) eventData.rewards = rewards.trim();
//             if (scoringMethod?.trim()) eventData.scoringMethod = scoringMethod.trim();
//             if (notes?.trim()) eventData.notes = notes.trim();
//         }

//         const event = new Event(eventData);
//         await event.save();
//         const populatedEvent = await Event.findById(event._id)
//             .populate('createdBy', 'username fullname img')
//             .lean();

//         const eventNotification = new LotteryRegistration({
//             userId: new mongoose.Types.ObjectId(req.user.userId),
//             eventId: event._id.toString(),
//             isEvent: true,
//             title: populatedEvent.title,
//             type: populatedEvent.type,
//             region: '',
//             numbers: {},
//             createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate()
//         });
//         await eventNotification.save();

//         const users = await User.find().select('_id role').lean();
//         const notificationPromises = users.map(user => {
//             return new Notification({
//                 userId: user._id,
//                 type: 'NEW_EVENT',
//                 content: `HOT!!! ${populatedEvent.type === 'event' ? 'sự kiện' : populatedEvent.type === 'hot_news' ? 'tin hot' : 'thảo luận'}: ${populatedEvent.title} `,
//                 isRead: false,
//                 createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate(),
//                 eventId: event._id.toString()
//             }).save();
//         });
//         const notifications = await Promise.all(notificationPromises);

//         notifications.forEach(notification => {
//             console.log(`Broadcasting NEW_EVENT to user:${notification.userId} (role: ${users.find(u => u._id.toString() === notification.userId.toString())?.role})`);
//             broadcastComment({
//                 type: 'NEW_EVENT',
//                 data: {
//                     notificationId: notification._id.toString(),
//                     userId: notification.userId.toString(),
//                     type: 'NEW_EVENT',
//                     content: notification.content,
//                     isRead: false,
//                     createdAt: notification.createdAt,
//                     eventId: event._id.toString(),
//                     createdBy: populatedEvent.createdBy
//                 },
//                 room: `user:${notification.userId} `
//             });
//         });

//         const populatedNotification = await LotteryRegistration.findById(eventNotification._id)
//             .populate('userId', 'username fullname img titles points winCount')
//             .lean();
//         broadcastComment({
//             type: 'NEW_EVENT_NOTIFICATION',
//             data: {
//                 ...populatedNotification,
//                 eventId: populatedNotification.eventId.toString()
//             },
//             room: 'lotteryFeed'
//         });

//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(201).json({
//             message: 'Tạo sự kiện thành công',
//             event: populatedEvent
//         });
//     } catch (err) {
//         console.error('Error in POST /events:', err.message);
//         res.status(500).json({ error: err.message || 'Đã có lỗi khi tạo sự kiện' });
//     }
// });

// router.put('/:id', authenticate, isAdmin, async (req, res) => {
//     try {
//         const { id } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id)) {
//             return res.status(400).json({ message: 'ID sự kiện không hợp lệ' });
//         }
//         const { title, content, type, lotteryFields, startTime, endTime, rules, rewards, scoringMethod, notes } = req.body;

//         if (!['event', 'hot_news', 'discussion'].includes(type)) {
//             return res.status(400).json({ message: 'Loại không hợp lệ' });
//         }
//         if (!title || !content) {
//             return res.status(400).json({ message: 'Tiêu đề và nội dung là bắt buộc' });
//         }
//         if (type !== 'discussion' && startTime && endTime && moment(endTime).isBefore(startTime)) {
//             return res.status(400).json({ message: 'Thời gian kết thúc phải sau thời gian bắt đầu' });
//         }

//         const event = await Event.findById(id);
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
//         }

//         const eventData = {
//             title,
//             content,
//             type,
//             lotteryFields: type === 'event' ? {
//                 bachThuLo: !!lotteryFields?.bachThuLo,
//                 songThuLo: !!lotteryFields?.songThuLo,
//                 threeCL: !!lotteryFields?.threeCL,
//                 cham: !!lotteryFields?.cham
//             } : {
//                 bachThuLo: false,
//                 songThuLo: false,
//                 threeCL: false,
//                 cham: false
//             },
//             updatedAt: moment.tz('Asia/Ho_Chi_Minh').toDate()
//         };

//         if (type !== 'discussion') {
//             if (startTime) eventData.startTime = moment.tz(startTime, 'Asia/Ho_Chi_Minh').toDate();
//             if (endTime) eventData.endTime = moment.tz(endTime, 'Asia/Ho_Chi_Minh').toDate();
//             if (rules?.trim()) eventData.rules = rules.trim();
//             if (rewards?.trim()) eventData.rewards = rewards.trim();
//             if (scoringMethod?.trim()) eventData.scoringMethod = scoringMethod.trim();
//             if (notes?.trim()) eventData.notes = notes.trim();
//         }

//         Object.assign(event, eventData);
//         await event.save();
//         const populatedEvent = await Event.findById(id)
//             .populate('createdBy', 'username fullname img')
//             .lean();

//         broadcastComment({
//             type: 'EVENT_UPDATED',
//             data: populatedEvent,
//             room: 'lotteryFeed'
//         });

//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({
//             message: 'Cập nhật sự kiện thành công',
//             event: populatedEvent
//         });
//     } catch (err) {
//         console.error('Error in PUT /events/:id:', err.message);
//         res.status(500).json({ error: err.message || 'Đã có lỗi khi cập nhật sự kiện' });
//     }
// });

// router.delete('/:id', authenticate, isAdmin, async (req, res) => {
//     try {
//         const { id } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id)) {
//             return res.status(400).json({ message: 'ID sự kiện không hợp lệ' });
//         }
//         const event = await Event.findById(id);
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
//         }
//         await Event.deleteOne({ _id: id });
//         await LotteryRegistration.deleteMany({ eventId: id });
//         await Notification.deleteMany({ eventId: id });

//         broadcastComment({
//             type: 'EVENT_DELETED',
//             data: { eventId: id, type: event.type },
//             room: 'lotteryFeed'
//         });

//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ message: 'Xóa sự kiện thành công' });
//     } catch (err) {
//         console.error('Error in DELETE /events/:id:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi xóa sự kiện' });
//     }
// });

// router.post('/:id/comments', authenticate, async (req, res) => {
//     try {
//         const { id } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id)) {
//             return res.status(400).json({ message: 'ID sự kiện không hợp lệ' });
//         }
//         const { content } = req.body;
//         if (!content || content.trim().length === 0) {
//             return res.status(400).json({ message: 'Nội dung bình luận là bắt buộc' });
//         }
//         const event = await Event.findById(id);
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy event/tin hot/thảo luận' });
//         }
//         const newComment = {
//             _id: new mongoose.Types.ObjectId(),
//             userId: new mongoose.Types.ObjectId(req.user.userId),
//             content,
//             createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate()
//         };
//         event.comments.push(newComment);
//         await event.save();
//         const populatedEvent = await Event.findById(id)
//             .populate('createdBy', 'username fullname img')
//             .populate('comments.userId', 'username fullname img')
//             .lean();
//         const populatedComment = populatedEvent.comments.find(c => c._id.toString() === newComment._id.toString());
//         const commentCount = populatedEvent.comments.length +
//             populatedEvent.comments.reduce((total, comment) => total + (comment.replies?.length || 0), 0);
//         broadcastComment({
//             type: 'NEW_COMMENT',
//             data: {
//                 ...populatedComment,
//                 eventId: id,
//                 commentCount
//             },
//             room: `event:${id}`
//         });
//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ message: 'Bình luận thành công', event: populatedEvent });
//     } catch (err) {
//         console.error('Error in POST /events/:id/comments:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi thêm bình luận' });
//     }
// });

// router.post('/:id/comments/:commentId/like', authenticate, async (req, res) => {
//     try {
//         const { id, commentId } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(commentId)) {
//             return res.status(400).json({ message: 'ID không hợp lệ' });
//         }
//         const event = await Event.findById(id);
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
//         }
//         const comment = event.comments.id(commentId);
//         if (!comment) {
//             return res.status(404).json({ message: 'Không tìm thấy bình luận' });
//         }
//         const userId = new mongoose.Types.ObjectId(req.user.userId);
//         const index = comment.likes.indexOf(userId);
//         let action = '';
//         if (index === -1) {
//             comment.likes.push(userId);
//             action = 'liked';
//         } else {
//             comment.likes.splice(index, 1);
//             action = 'unliked';
//         }
//         await event.save();
//         const populatedEvent = await Event.findById(id)
//             .populate('createdBy', 'username fullname img')
//             .populate('comments.userId', 'username fullname img')
//             .populate('comments.replies.userId', 'username fullname img')
//             .lean();
//         const populatedComment = populatedEvent.comments.find(c => c._id.toString() === commentId);
//         broadcastComment({
//             type: 'COMMENT_LIKED',
//             data: {
//                 commentId,
//                 userId: req.user.userId,
//                 eventId: id,
//                 action,
//                 likes: populatedComment.likes
//             },
//             room: `event:${id}`
//         });
//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ message: `Đã ${action === 'liked' ? 'thích' : 'bỏ thích'} bình luận`, event: populatedEvent });
//     } catch (err) {
//         console.error('Error in POST /events/:id/comments/:commentId/like:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi thích/bỏ thích bình luận' });
//     }
// });

// router.post('/:id/comments/:commentId/reply', authenticate, async (req, res) => {
//     try {
//         const { id, commentId } = req.params;
//         const { content } = req.body;
//         if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(commentId)) {
//             return res.status(400).json({ message: 'ID không hợp lệ' });
//         }
//         if (!content || content.trim().length === 0) {
//             return res.status(400).json({ message: 'Nội dung trả lời là bắt buộc' });
//         }
//         const event = await Event.findById(id);
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
//         }
//         const comment = event.comments.id(commentId);
//         if (!comment) {
//             return res.status(404).json({ message: 'Không tìm thấy bình luận' });
//         }
//         const newReply = {
//             userId: new mongoose.Types.ObjectId(req.user.userId),
//             content,
//             createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate(),
//             likes: []
//         };
//         comment.replies.push(newReply);
//         await event.save();
//         const populatedEvent = await Event.findById(id)
//             .populate('createdBy', 'username fullname img')
//             .populate('comments.userId', 'username fullname img')
//             .populate('comments.replies.userId', 'username fullname img')
//             .lean();
//         const populatedComment = populatedEvent.comments.find(c => c._id.toString() === commentId);
//         const populatedReply = populatedComment.replies[populatedComment.replies.length - 1];
//         const commentCount = populatedEvent.comments.length +
//             populatedEvent.comments.reduce((total, comment) => total + (comment.replies?.length || 0), 0);
//         broadcastComment({
//             type: 'NEW_REPLY',
//             data: {
//                 ...populatedReply,
//                 eventId: id,
//                 commentId,
//                 commentCount
//             },
//             room: `event:${id}`
//         });
//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ message: 'Trả lời bình luận thành công', event: populatedEvent });
//     } catch (err) {
//         console.error('Error in POST /events/:id/comments/:commentId/reply:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi trả lời bình luận' });
//     }
// });

// router.delete('/:id/comments/:commentId', authenticate, isAdmin, async (req, res) => {
//     try {
//         const { id, commentId } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(commentId)) {
//             return res.status(400).json({ message: 'ID không hợp lệ' });
//         }
//         const event = await Event.findById(id);
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
//         }
//         const comment = event.comments.id(commentId);
//         if (!comment) {
//             return res.status(404).json({ message: 'Không tìm thấy bình luận' });
//         }
//         event.comments.pull(commentId);
//         await event.save();
//         const populatedEvent = await Event.findById(id)
//             .populate('createdBy', 'username fullname img')
//             .populate('comments.userId', 'username fullname img')
//             .populate('comments.replies.userId', 'username fullname img')
//             .lean();
//         const commentCount = populatedEvent.comments.length +
//             populatedEvent.comments.reduce((total, comment) => total + (comment.replies?.length || 0), 0);
//         broadcastComment({
//             type: 'COMMENT_DELETED',
//             data: {
//                 commentId,
//                 eventId: id,
//                 commentCount
//             },
//             room: `event:${id}`
//         });
//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ message: 'Xóa bình luận thành công', event: populatedEvent });
//     } catch (err) {
//         console.error('Error in DELETE /events/:id/comments/:commentId:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi xóa bình luận' });
//     }
// });

// router.post('/:id/comments/:commentId/replies/:replyId/like', authenticate, async (req, res) => {
//     try {
//         const { id, commentId, replyId } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(commentId) || !mongoose.Types.ObjectId.isValid(replyId)) {
//             return res.status(400).json({ message: 'ID không hợp lệ' });
//         }
//         const event = await Event.findById(id);
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
//         }
//         const comment = event.comments.id(commentId);
//         if (!comment) {
//             return res.status(404).json({ message: 'Không tìm thấy bình luận' });
//         }
//         const reply = comment.replies.id(replyId);
//         if (!reply) {
//             return res.status(404).json({ message: 'Không tìm thấy trả lời' });
//         }
//         const userId = new mongoose.Types.ObjectId(req.user.userId);
//         const index = reply.likes.indexOf(userId);
//         let action = '';
//         if (index === -1) {
//             reply.likes.push(userId);
//             action = 'liked';
//         } else {
//             reply.likes.splice(index, 1);
//             action = 'unliked';
//         }
//         await event.save();
//         const populatedEvent = await Event.findById(id)
//             .populate('createdBy', 'username fullname img role')
//             .populate('comments.userId', 'username fullname img role')
//             .populate('comments.replies.userId', 'username fullname img role')
//             .lean();
//         const populatedComment = populatedEvent.comments.find(c => c._id.toString() === commentId);
//         const populatedReply = populatedComment.replies.find(r => r._id.toString() === replyId);
//         broadcastComment({
//             type: 'REPLY_LIKED',
//             data: {
//                 replyId,
//                 commentId,
//                 userId: req.user.userId,
//                 eventId: id,
//                 action,
//                 likes: populatedReply.likes
//             },
//             room: `event:${id}`
//         });
//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ message: `Đã ${action === 'liked' ? 'thích' : 'bỏ thích'} trả lời`, event: populatedEvent });
//     } catch (err) {
//         console.error('Error in POST /events/:id/comments/:commentId/replies/:replyId/like:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi thích/bỏ thích trả lời' });
//     }
// });

// router.delete('/:id/comments/:commentId/replies/:replyId', authenticate, isAdmin, async (req, res) => {
//     try {
//         const { id, commentId, replyId } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(commentId) || !mongoose.Types.ObjectId.isValid(replyId)) {
//             return res.status(400).json({ message: 'ID không hợp lệ' });
//         }
//         const event = await Event.findById(id);
//         if (!event) {
//             return res.status(404).json({ message: 'Không tìm thấy sự kiện' });
//         }
//         const comment = event.comments.id(commentId);
//         if (!comment) {
//             return res.status(404).json({ message: 'Không tìm thấy bình luận' });
//         }
//         const reply = comment.replies.id(replyId);
//         if (!reply) {
//             return res.status(404).json({ message: 'Không tìm thấy trả lời' });
//         }
//         comment.replies.pull(replyId);
//         await event.save();
//         const populatedEvent = await Event.findById(id)
//             .populate('createdBy', 'username fullname img role')
//             .populate('comments.userId', 'username fullname img role')
//             .populate('comments.replies.userId', 'username fullname img role')
//             .lean();
//         const commentCount = populatedEvent.comments.length +
//             populatedEvent.comments.reduce((total, comment) => total + (comment.replies?.length || 0), 0);
//         broadcastComment({
//             type: 'REPLY_DELETED',
//             data: {
//                 replyId,
//                 commentId,
//                 eventId: id,
//                 commentCount
//             },
//             room: `event:${id}`
//         });
//         res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
//         res.status(200).json({ message: 'Xóa trả lời thành công', event: populatedEvent });
//     } catch (err) {
//         console.error('Error in DELETE /events/:id/comments/:commentId/replies/:replyId:', err.message);
//         res.status(500).json({ message: err.message || 'Đã có lỗi khi xóa trả lời' });
//     }
// });

// module.exports = router;