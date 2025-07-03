const mongoose = require('mongoose');
const moment = require('moment-timezone');

const eventSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['event', 'hot_news'],
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    comments: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        content: {
            type: String,
            required: true
        },
        createdAt: {
            type: Date,
            default: () => moment.tz('Asia/Ho_Chi_Minh').toDate()
        }
    }],
    lotteryFields: {
        type: {
            bachThuLo: { type: Boolean, default: false },
            songThuLo: { type: Boolean, default: false },
            threeCL: { type: Boolean, default: false },
            cham: { type: Boolean, default: false }
        },
        default: {
            bachThuLo: false,
            songThuLo: false,
            threeCL: false,
            cham: false
        }
    },
    viewCount: {
        type: Number,
        default: 0 // Thêm trường viewCount để lưu số lượt xem
    }
}, {
    timestamps: {
        currentTime: () => moment.tz('Asia/Ho_Chi_Minh').toDate()
    }
});

module.exports = mongoose.model('Event', eventSchema);