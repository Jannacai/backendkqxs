"use strict";

const mongoose = require('mongoose');

const lotteryRegistrationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    region: { type: String, enum: ['Nam', 'Trung', 'Bac'], required: true },
    numbers: {
        bachThuLo: { type: String, default: null },
        songThuLo: { type: [String], default: [] },
        threeCL: { type: String, default: null },
        cham: { type: String, default: null }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: null },
    updatedCount: { type: Number, default: 0 },
    result: {
        isChecked: { type: Boolean, default: false },
        isWin: { type: Boolean, default: false },
        winningNumbers: {
            bachThuLo: { type: Boolean, default: false },
            songThuLo: { type: [String], default: [] },
            threeCL: { type: Boolean, default: false },
            cham: { type: Boolean, default: false }
        },
        matchedPrizes: [{ type: String }], // Lưu các giải trúng (e.g., 'specialPrize_0', 'firstPrize_0')
        checkedAt: { type: Date, default: null }
    }
});

// Đảm bảo ít nhất một trường số được cung cấp
lotteryRegistrationSchema.pre('save', function (next) {
    const { bachThuLo, songThuLo, threeCL, cham } = this.numbers;
    if (!bachThuLo && songThuLo.length === 0 && !threeCL && !cham) {
        return next(new Error('Vui lòng cung cấp ít nhất một số để đăng ký'));
    }
    next();
});

module.exports = mongoose.model('LotteryRegistration', lotteryRegistrationSchema);