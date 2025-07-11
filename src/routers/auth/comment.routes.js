// "use strict";

// const express = require("express");
// const router = express.Router();
// const commentModel = require("../../models/comments.models");
// const userModel = require("../../models/users.models.js");
// // const notificationModel = require("../../models/notification.models.js");
// const { authenticate } = require("./auth.routes.js");
// const rateLimit = require("express-rate-limit");
// const { broadcastComment } = require("../../websocket.js");

// const commentLimiter = rateLimit({
//     windowMs: 60 * 1000,
//     max: 10,
//     message: "Quá nhiều bình luận. Vui lòng thử lại sau 1 phút.",
// });

// const likeLimiter = rateLimit({
//     windowMs: 60 * 1000,
//     max: 20,
//     message: "Quá nhiều lượt thích. Vui lòng thử lại sau 1 phút.",
// });

// const restrictToAdmin = async (req, res, next) => {
//     try {
//         const user = await userModel.findById(req.user.userId);
//         if (!user || user.role !== "ADMIN") {
//             return res.status(403).json({ error: "Chỉ ADMIN mới có quyền thực hiện hành động này" });
//         }
//         next();
//     } catch (error) {
//         console.error("Error in restrictToAdmin:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// };

// router.get("/", async (req, res) => {
//     try {
//         const { page = 1, limit = 20 } = req.query;
//         const skip = (page - 1) * limit;

//         const comments = await commentModel
//             .find({ parentComment: null })
//             .sort({ createdAt: -1 })
//             .skip(skip)
//             .limit(Number(limit))
//             .populate("createdBy", "username fullname role")
//             .populate("taggedUsers", "username fullname role")
//             .populate({
//                 path: "childComments",
//                 populate: [
//                     { path: "createdBy", select: "username fullname role" },
//                     { path: "taggedUsers", select: "username fullname role" },
//                 ],
//                 options: { sort: { createdAt: -1 } },
//             });

//         res.status(200).json(comments);
//     } catch (error) {
//         console.error("Error in GET /comments:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// router.post("/", authenticate, commentLimiter, async (req, res) => {
//     const { content, parentComment, taggedUsers } = req.body;

//     if (!content || !content.trim()) {
//         return res.status(400).json({ error: "Nội dung bình luận là bắt buộc" });
//     }

//     try {
//         let depth = 0;
//         let parent = null;
//         if (parentComment) {
//             parent = await commentModel.findById(parentComment);
//             if (!parent) {
//                 return res.status(404).json({ error: "Bình luận cha không tồn tại" });
//             }
//             depth = parent.depth + 1;
//             if (depth > 1) {
//                 return res.status(400).json({ error: "Đã đến giới hạn bình luận" });
//             }
//         }

//         const [validTaggedUsers, currentUser] = await Promise.all([
//             taggedUsers && Array.isArray(taggedUsers)
//                 ? userModel.find({ _id: { $in: taggedUsers } }).select("_id")
//                 : Promise.resolve([]),
//             userModel.findById(req.user.userId).select("username fullname"),
//         ]);

//         const comment = new commentModel({
//             content,
//             createdBy: req.user.userId,
//             parentComment: parentComment || null,
//             depth,
//             taggedUsers: validTaggedUsers.map(user => user._id),
//             likes: 0,
//             likedBy: [],
//         });

//         const [savedComment] = await Promise.all([
//             comment.save(),
//             parent ? parent.updateOne({ $push: { childComments: comment._id } }) : Promise.resolve(),
//         ]);

//         const populatedComment = await commentModel
//             .findById(savedComment._id)
//             .populate("createdBy", "username fullname role")
//             .populate("taggedUsers", "username fullname role");

//         const notifications = [];
//         for (const taggedUserId of validTaggedUsers) {
//             if (taggedUserId.toString() !== req.user.userId.toString()) {
//                 notifications.push({
//                     userId: taggedUserId,
//                     commentId: savedComment._id,
//                     taggedBy: req.user.userId,
//                     content: `${currentUser.fullname || currentUser.username} đã tag bạn trong một bình luận: "${content.slice(0, 50)}..."`,
//                 });
//             }
//         }

//         if (parent && parent.createdBy.toString() !== req.user.userId.toString()) {
//             notifications.push({
//                 userId: parent.createdBy,
//                 commentId: savedComment._id,
//                 taggedBy: req.user.userId,
//                 content: `${currentUser.fullname} đã trả lời bình luận của bạn: "${content.slice(0, 50)}..."`,
//             });
//         }

//         if (parent) {
//             const siblingComments = await commentModel
//                 .find({ parentComment, _id: { $ne: savedComment._id } })
//                 .select("createdBy")
//                 .lean();
//             const notifiedUsers = new Set([req.user.userId.toString(), parent.createdBy.toString()]);
//             for (const sibling of siblingComments) {
//                 if (!notifiedUsers.has(sibling.createdBy.toString())) {
//                     notifications.push({
//                         userId: sibling.createdBy,
//                         commentId: savedComment._id,
//                         taggedBy: req.user.userId,
//                         content: `${currentUser.fullname} đã trả lời trong chủ đề bạn tham gia: "${content.slice(0, 50)}..."`,
//                     });
//                     notifiedUsers.add(sibling.createdBy.toString());
//                 }
//             }
//         }

//         if (notifications.length > 0) {
//             notificationModel.insertMany(notifications).catch(err => {
//                 console.error("Error saving notifications:", err.message);
//             });
//         }

//         broadcastComment({
//             type: "NEW_COMMENT",
//             data: populatedComment,
//         });

//         res.status(201).json(populatedComment);
//     } catch (error) {
//         console.error("Error in POST /comments:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// router.post("/:id/like", authenticate, likeLimiter, async (req, res) => {
//     try {
//         const comment = await commentModel.findById(req.params.id);
//         if (!comment) {
//             return res.status(404).json({ error: "Bình luận không tồn tại" });
//         }

//         const userId = req.user.userId;
//         const hasLiked = comment.likedBy.includes(userId);

//         comment.likedBy = hasLiked
//             ? comment.likedBy.filter(id => id.toString() !== userId.toString())
//             : [...comment.likedBy, userId];
//         comment.likes = comment.likedBy.length;

//         await comment.save();
//         const populatedComment = await commentModel
//             .findById(comment._id)
//             .populate("createdBy", "username fullname role")
//             .populate("taggedUsers", "username fullname role");

//         broadcastComment({
//             type: "LIKE_UPDATE",
//             data: populatedComment,
//         });

//         res.status(200).json(populatedComment);
//     } catch (error) {
//         console.error("Error in /comments/:id/like:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// router.delete("/:id", authenticate, restrictToAdmin, async (req, res) => {
//     try {
//         const comment = await commentModel.findById(req.params.id);
//         if (!comment) {
//             return res.status(404).json({ error: "Bình luận không tồn tại" });
//         }

//         const deleteChildComments = async (parentId) => {
//             const children = await commentModel.find({ parentComment: parentId });
//             for (const child of children) {
//                 await deleteChildComments(child._id);
//                 await child.deleteOne();
//             }
//         };

//         await Promise.all([
//             deleteChildComments(comment._id),
//             comment.deleteOne(),
//             notificationModel.deleteMany({ commentId: comment._id }),
//         ]);

//         broadcastComment({
//             type: "DELETE_COMMENT",
//             data: { _id: comment._id },
//         });

//         res.status(200).json({ message: "Bình luận và các bình luận con đã được xóa" });
//     } catch (error) {
//         console.error("Error in /comments/:id DELETE:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// module.exports = router;