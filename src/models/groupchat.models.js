// const mongoose = require('mongoose');
// const moment = require('moment-timezone');

// const GroupchatSchema = new mongoose.Schema({
//     userId: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: 'User',
//         required: true,
//     },
//     receiverId: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: 'User',
//         default: null, // null cho tin nhắn group, có giá trị cho tin nhắn private
//     },
//     content: {
//         type: String,
//         required: true,
//         trim: true,
//         maxlength: 1000,
//     },
//     createdAt: {
//         type: Date,
//         default: () => moment.tz('Asia/Ho_Chi_Minh').toDate(),
//     },
//     isPrivate: {
//         type: Boolean,
//         default: false, // false cho group chat, true cho private chat
//     },
// }, {
//     timestamps: {
//         currentTime: () => moment.tz('Asia/Ho_Chi_Minh').toDate(),
//     },
// });

// module.exports = mongoose.model('Groupchat', GroupchatSchema);