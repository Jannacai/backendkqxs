// const { getRedisClient } = require('../utils/redis');
// const notificationModel = require('../models/notification.models');
// const commentModel = require('../models/comments.models');
// const userModel = require('../models/users.models');

// const processNotificationQueue = async () => {
//     const redisClient = await getRedisClient();
//     console.log('Notification worker started');

//     while (true) {
//         try {
//             const job = await redisClient.brPop('notification_queue', 0);
//             const {
//                 commentId,
//                 taggedUsers,
//                 parentCommentIds,
//                 parentComment,
//                 currentUser,
//                 content,
//             } = JSON.parse(job[1]);

//             // Gửi thông báo cho người được tag
//             for (const taggedUserId of taggedUsers) {
//                 if (taggedUserId.toString() !== currentUser._id.toString()) {
//                     const notification = new notificationModel({
//                         userId: taggedUserId,
//                         commentId,
//                         taggedBy: currentUser._id,
//                         content: `${currentUser.fullname || currentUser.username} đã tag bạn trong một bình luận: "${content.slice(0, 50)}..."`,
//                     });
//                     await notification.save();
//                     console.log("Notification saved for tagged user:", taggedUserId);
//                 }
//             }

//             // Gửi thông báo cho người tạo comment cha
//             for (const parentUserId of parentCommentIds) {
//                 const notification = new notificationModel({
//                     userId: parentUserId,
//                     commentId,
//                     taggedBy: currentUser._id,
//                     content: `${currentUser.fullname} đã trả lời bình luận của bạn: "${content.slice(0, 50)}..."`,
//                 });
//                 await notification.save();
//                 console.log("Notification saved for parent comment owner:", parentUserId);
//             }

//             // Gửi thông báo cho người tham gia chủ đề
//             if (parentComment) {
//                 const siblingComments = await commentModel
//                     .find({ parentComment, _id: { $ne: commentId } })
//                     .populate("createdBy", "username fullname");
//                 const notifiedUsers = new Set([currentUser._id.toString(), ...parentCommentIds]);
//                 for (const sibling of siblingComments) {
//                     if (!notifiedUsers.has(sibling.createdBy._id.toString())) {
//                         const notification = new notificationModel({
//                             userId: sibling.createdBy._id,
//                             commentId,
//                             taggedBy: currentUser._id,
//                             content: `${currentUser.fullname} đã trả lời trong chủ đề bạn tham gia: "${content.slice(0, 50)}..."`,
//                         });
//                         await notification.save();
//                         console.log("Notification saved for sibling comment owner:", sibling.createdBy._id);
//                         notifiedUsers.add(sibling.createdBy._id.toString());
//                     }
//                 }
//             }
//         } catch (error) {
//             console.error("Error processing notification queue:", error.message);
//         }
//     }
// };

// // Khởi động worker
// processNotificationQueue().catch(err => {
//     console.error("Failed to start notification worker:", err);
//     process.exit(1);
// });

// module.exports = { processNotificationQueue };