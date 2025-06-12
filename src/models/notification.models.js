const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Người nhận thông báo
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', required: true }, // Bình luận liên quan
    taggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Người tag
    content: { type: String, required: true }, // Nội dung thông báo (tóm tắt bình luận)
    isRead: { type: Boolean, default: false }, // Trạng thái đã đọc
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Notification', notificationSchema);