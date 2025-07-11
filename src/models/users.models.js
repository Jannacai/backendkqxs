// const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');
// const moment = require('moment-timezone');

// // Mảng ánh xạ số điểm với danh hiệu
// const TITLE_THRESHOLDS = [
//     { title: 'Tân thủ', minPoints: 0, maxPoints: 100 },
//     { title: 'Học Giả', minPoints: 101, maxPoints: 500 },
//     { title: 'Chuyên Gia', minPoints: 501, maxPoints: 1000 },
//     { title: 'Thần Số Học', minPoints: 1001, maxPoints: 2000 },
//     { title: 'Thần Chốt Số', minPoints: 2001, maxPoints: 5000 },
// ];

// // Mảng ánh xạ số điểm với cấp độ
// const LEVEL_THRESHOLDS = [
//     { level: 1, minPoints: 0, maxPoints: 100 },
//     { level: 2, minPoints: 101, maxPoints: 200 },
//     { level: 3, minPoints: 201, maxPoints: 300 },
//     { level: 4, minPoints: 401, maxPoints: 500 },
// ];

// // Mảng danh hiệu hợp lệ
// const TITLES = TITLE_THRESHOLDS.map(threshold => threshold.title);

// const refreshTokenSchema = new mongoose.Schema({
//     token: { type: String, required: true },
//     deviceInfo: { type: String, required: true },
//     expiresAt: { type: Date, required: true },
// });

// const userSchema = new mongoose.Schema({
//     username: { type: String, required: true, unique: true },
//     email: { type: String, required: true, unique: true },
//     fullname: { type: String, required: true },
//     password: { type: String, required: true },
//     phoneNumber: { type: String, required: false },
//     img: { type: String, required: false },
//     titles: [{ type: String, enum: TITLES, default: 'Tân thủ' }],
//     points: { type: Number, default: 0 },
//     level: { type: Number, default: 1 },
//     winCount: { type: Number, default: 0 },
//     role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER' },
//     refreshTokens: [refreshTokenSchema],
//     failedLoginAttempts: { type: Number, default: 0 },
//     lockUntil: { type: Date, default: null },
//     isOnline: { type: Boolean, default: false }, // Thêm trường isOnline
//     lastActive: { type: Date }, // Thêm trường lastActive
//     socketId: { type: String, default: null },
//     createdAt: {
//         type: Date,
//         default: () => moment.tz('Asia/Ho_Chi_Minh').toDate()
//     },
// }, {
//     timestamps: {
//         currentTime: () => moment.tz('Asia/Ho_Chi_Minh').toDate()
//     }
// });

// // Middleware để hash mật khẩu
// userSchema.pre('save', async function (next) {
//     if (this.isModified('password')) {
//         this.password = await bcrypt.hash(this.password, 10);
//     }
//     next();
// });

// // Middleware để cập nhật danh hiệu và cấp độ dựa trên số điểm
// userSchema.pre('save', async function (next) {
//     if (this.isModified('points')) {
//         const currentPoints = this.points;

//         // Cập nhật danh hiệu
//         const newTitle = TITLE_THRESHOLDS.find(
//             threshold => currentPoints >= threshold.minPoints && currentPoints <= threshold.maxPoints
//         )?.title;
//         if (newTitle && !this.titles.includes(newTitle)) {
//             this.titles.push(newTitle);
//         }

//         // Cập nhật cấp độ
//         const newLevel = LEVEL_THRESHOLDS.find(
//             threshold => currentPoints >= threshold.minPoints && currentPoints <= threshold.maxPoints
//         )?.level;
//         if (newLevel && this.level !== newLevel) {
//             this.level = newLevel;
//         }
//     }
//     next();
// });

// // Phương thức so sánh mật khẩu
// userSchema.methods.comparePassword = async function (password) {
//     return await bcrypt.compare(password, this.password);
// };

// // Phương thức tĩnh để thêm danh hiệu mới
// userSchema.statics.addTitle = function (newTitle, minPoints, maxPoints) {
//     if (!TITLES.includes(newTitle)) {
//         TITLES.push(newTitle);
//         TITLE_THRESHOLDS.push({ title: newTitle, minPoints, maxPoints });
//         userSchema.path('titles').enum(TITLES);
//     }
// };

// // Phương thức tĩnh để thêm cấp độ mới
// userSchema.statics.addLevel = function (level, minPoints, maxPoints) {
//     if (!LEVEL_THRESHOLDS.some(threshold => threshold.level === level)) {
//         LEVEL_THRESHOLDS.push({ level, minPoints, maxPoints });
//     }
// };

// module.exports = mongoose.model('User', userSchema);