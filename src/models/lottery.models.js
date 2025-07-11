// const mongoose = require('mongoose');
// const moment = require('moment-timezone');

// const lotteryRegistrationSchema = new mongoose.Schema({
//     userId: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: 'User',
//         required: true
//     },
//     eventId: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: 'Event',
//         index: true,
//         required: false // Không bắt buộc cho thông báo phát thưởng hoặc sự kiện
//     },
//     region: {
//         type: String,
//         enum: ['Nam', 'Trung', 'Bac', ''], // Thêm '' cho thông báo phát thưởng hoặc sự kiện
//         default: ''
//     },
//     numbers: {
//         bachThuLo: { type: String, default: null },
//         songThuLo: { type: [String], default: [] },
//         threeCL: { type: String, default: null },
//         cham: { type: String, default: null }
//     },
//     updatedCount: {
//         type: Number,
//         default: 0
//     },
//     result: {
//         type: {
//             isChecked: { type: Boolean, default: false },
//             isWin: { type: Boolean, default: false },
//             winningNumbers: {
//                 bachThuLo: { type: Boolean, default: false },
//                 songThuLo: { type: [String], default: [] },
//                 threeCL: { type: Boolean, default: false },
//                 cham: { type: Boolean, default: false }
//             },
//             matchedPrizes: { type: [String], default: [] },
//             checkedAt: { type: Date, default: null }
//         },
//         default: {
//             isChecked: false,
//             isWin: false,
//             winningNumbers: {
//                 bachThuLo: false,
//                 songThuLo: [],
//                 threeCL: false,
//                 cham: false
//             },
//             matchedPrizes: [],
//             checkedAt: null
//         }
//     },
//     isReward: {
//         type: Boolean,
//         default: false
//     },
//     pointsAwarded: {
//         type: Number,
//         default: null
//     },
//     isEvent: {
//         type: Boolean,
//         default: false
//     },
//     title: {
//         type: String,
//         default: null
//     },
//     type: {
//         type: String,
//         enum: ['event', 'hot_news', 'discussion', 'USER_REWARDED', null],
//         default: null
//     }
// }, {
//     timestamps: {
//         currentTime: () => moment.tz('Asia/Ho_Chi_Minh').toDate()
//     }
// });

// lotteryRegistrationSchema.index({ userId: 1, type: 1, createdAt: -1 });

// module.exports = mongoose.model('LotteryRegistration', lotteryRegistrationSchema);