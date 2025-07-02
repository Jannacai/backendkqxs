const mongoose = require('mongoose');
const moment = require('moment-timezone'); // Thêm import moment-timezone

const lotteryRegistrationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    region: {
        type: String,
        required: true,
        enum: ['Nam', 'Trung', 'Bac']
    },
    numbers: {
        bachThuLo: { type: String, default: null },
        songThuLo: { type: [String], default: [] },
        threeCL: { type: String, default: null },
        cham: { type: String, default: null }
    },
    updatedCount: {
        type: Number,
        default: 0
    },
    result: {
        type: {
            isChecked: { type: Boolean, default: false },
            isWin: { type: Boolean, default: false },
            winningNumbers: {
                bachThuLo: { type: Boolean, default: false },
                songThuLo: { type: [String], default: [] },
                threeCL: { type: Boolean, default: false },
                cham: { type: Boolean, default: false }
            },
            matchedPrizes: { type: [String], default: [] },
            checkedAt: { type: Date, default: null }
        },
        default: {
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
    }
}, {
    timestamps: {
        currentTime: () => moment.tz('Asia/Ho_Chi_Minh').toDate() // Đặt múi giờ cho timestamps
    }
});

module.exports = mongoose.model('LotteryRegistration', lotteryRegistrationSchema);