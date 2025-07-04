const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: ['NEW_EVENT', 'USER_REWARDED', 'NEW_LOTTERY_REGISTRATION', 'COMMENT_TAG'] },
    content: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: false },
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', required: false },
    taggedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false }
});

module.exports = mongoose.model('Notification', notificationSchema);