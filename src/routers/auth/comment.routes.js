"use strict";

const express = require("express");
const router = express.Router();
const commentModel = require("../../models/comments.models");
const userModel = require("../../models/users.models.js");
const notificationModel = require("../../models/notification.models.js");
const { authenticate } = require("./auth.routes.js");

const restrictToAdmin = async (req, res, next) => {
    try {
        const user = await userModel.findById(req.user.userId);
        if (!user || user.role !== "ADMIN") {
            return res.status(403).json({ error: "Chỉ ADMIN mới có quyền thực hiện hành động này" });
        }
        next();
    } catch (error) {
        console.error("Error in restrictToAdmin:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// GET /api/comments - Public endpoint, không cần xác thực
router.get("/", async (req, res) => {
    try {
        const comments = await commentModel
            .find({ parentComment: null })
            .sort({ createdAt: -1 })
            .populate("createdBy", "username fullname role")
            .populate("taggedUsers", "username fullname role")
            .populate({
                path: "childComments",
                populate: [
                    { path: "createdBy", select: "username fullname role" },
                    { path: "taggedUsers", select: "username fullname role" },
                    {
                        path: "childComments",
                        populate: [
                            { path: "createdBy", select: "username fullname role" },
                            { path: "taggedUsers", select: "username fullname role" },
                            {
                                path: "childComments",
                                populate: [
                                    { path: "createdBy", select: "username fullname role" },
                                    { path: "taggedUsers", select: "username fullname role" },
                                    {
                                        path: "childComments",
                                        populate: [
                                            { path: "createdBy", select: "username fullname role" },
                                            { path: "taggedUsers", select: "username fullname role" },
                                            {
                                                path: "childComments",
                                                populate: [
                                                    { path: "createdBy", select: "username fullname role" },
                                                    { path: "taggedUsers", select: "username fullname role" },
                                                ],
                                                options: { sort: { createdAt: -1 } },
                                            },
                                        ],
                                        options: { sort: { createdAt: -1 } },
                                    },
                                ],
                                options: { sort: { createdAt: -1 } },
                            },
                        ],
                        options: { sort: { createdAt: -1 } },
                    },
                ],
                options: { sort: { createdAt: -1 } },
            });
        console.log("Fetched comments:", comments.map(c => ({
            id: c._id,
            createdAt: c.createdAt,
            childComments: c.childComments?.map(child => child.createdAt) || [],
        })));
        res.status(200).json(comments);
    } catch (error) {
        console.error("Error in /comments:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/", authenticate, async (req, res) => {
    const { content, parentComment, taggedUsers } = req.body;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: "Nội dung bình luận là bắt buộc" });
    }

    try {
        let depth = 0;
        let parent = null;
        if (parentComment) {
            parent = await commentModel.findById(parentComment);
            if (!parent) {
                console.error("Parent comment not found:", parentComment);
                return res.status(404).json({ error: "Bình luận cha không tồn tại" });
            }
            depth = parent.depth + 1;
            console.log("Creating comment:", { content, parentComment, depth });
            if (depth > 1) {
                return res.status(400).json({ error: "Đã đến giới hạn bình luận" });
            }
        }

        let validTaggedUsers = [];
        if (taggedUsers && Array.isArray(taggedUsers)) {
            const users = await userModel.find({ _id: { $in: taggedUsers } });
            validTaggedUsers = users.map(user => user._id);
        }

        const comment = new commentModel({
            content,
            createdBy: req.user.userId,
            parentComment: parentComment || null,
            depth,
            taggedUsers: validTaggedUsers,
            likes: 0,
            likedBy: [],
        });
        await comment.save();

        if (parent) {
            if (!parent.childComments) {
                parent.childComments = [];
            }
            parent.childComments.push(comment._id);
            await parent.save();
            console.log("Updated parent comment:", parent._id, "with child:", comment._id);
        }

        const currentUser = await userModel.findById(req.user.userId).select("username fullname");

        // Tìm tất cả comment cha ở mọi cấp
        const parentCommentIds = new Set();
        let currentComment = parentComment ? await commentModel.findById(parentComment).populate('createdBy') : null;
        while (currentComment) {
            if (currentComment.createdBy && currentComment.createdBy._id.toString() !== req.user.userId.toString()) {
                parentCommentIds.add(currentComment.createdBy._id.toString());
            }
            currentComment = currentComment.parentComment
                ? await commentModel.findById(currentComment.parentComment).populate('createdBy')
                : null;
        }

        // Gửi thông báo cho người được tag
        for (const taggedUserId of validTaggedUsers) {
            if (taggedUserId.toString() !== req.user.userId.toString()) {
                const notification = new notificationModel({
                    userId: taggedUserId,
                    commentId: comment._id,
                    taggedBy: req.user.userId,
                    content: `${currentUser.fullname || currentUser.username} đã tag bạn trong một bình luận: "${content.slice(0, 50)}..."`,
                });
                await notification.save();
                console.log("Notification sent to tagged user:", taggedUserId);
            }
        }

        // Gửi thông báo cho người tạo comment cha ở mọi cấp
        for (const parentUserId of parentCommentIds) {
            const notification = new notificationModel({
                userId: parentUserId,
                commentId: comment._id,
                taggedBy: req.user.userId,
                content: `${currentUser.fullname} đã trả lời bình luận của bạn: "${content.slice(0, 50)}..."`,
            });
            await notification.save();
            console.log("Notification sent to parent comment owner:", parentUserId);
        }

        // Gửi thông báo cho người tham gia chủ đề (sibling comments)
        if (parent) {
            const siblingComments = await commentModel
                .find({ parentComment, _id: { $ne: comment._id } })
                .populate("createdBy", "username fullname");
            const notifiedUsers = new Set([req.user.userId.toString(), ...parentCommentIds]);
            for (const sibling of siblingComments) {
                if (!notifiedUsers.has(sibling.createdBy._id.toString())) {
                    const notification = new notificationModel({
                        userId: sibling.createdBy._id,
                        commentId: comment._id,
                        taggedBy: req.user.userId,
                        content: `${currentUser.fullname} đã trả lời trong chủ đề bạn tham gia: "${content.slice(0, 50)}..."`,
                    });
                    await notification.save();
                    console.log("Notification sent to sibling comment owner:", sibling.createdBy._id);
                    notifiedUsers.add(sibling.createdBy._id.toString());
                }
            }
        }

        const populatedComment = await commentModel
            .findById(comment._id)
            .populate("createdBy", "username fullname role")
            .populate("taggedUsers", "username fullname role");
        res.status(201).json(populatedComment);
    } catch (error) {
        console.error("Error in POST /comments:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/:id/like", authenticate, async (req, res) => {
    try {
        const comment = await commentModel.findById(req.params.id);
        if (!comment) {
            return res.status(404).json({ error: "Bình luận không tồn tại" });
        }

        const userId = req.user.userId;
        const hasLiked = comment.likedBy.includes(userId);

        if (!hasLiked) {
            comment.likedBy.push(userId);
            comment.likes += 1;
        } else {
            comment.likedBy = comment.likedBy.filter(id => id.toString() !== userId.toString());
            comment.likes -= 1;
        }

        await comment.save();
        const populatedComment = await commentModel
            .findById(comment._id)
            .populate("createdBy", "username fullname role")
            .populate("taggedUsers", "username fullname role");
        res.status(200).json(populatedComment);
    } catch (error) {
        console.error("Error in /comments/:id/like:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.delete("/:id", authenticate, restrictToAdmin, async (req, res) => {
    try {
        const comment = await commentModel.findById(req.params.id);
        if (!comment) {
            return res.status(404).json({ error: "Bình luận không tồn tại" });
        }

        const deleteChildComments = async (parentId) => {
            const children = await commentModel.find({ parentComment: parentId });
            for (const child of children) {
                await deleteChildComments(child._id);
                await child.deleteOne();
            }
        };
        await deleteChildComments(comment._id);
        await comment.deleteOne();
        await notificationModel.deleteMany({ commentId: comment._id });
        res.status(200).json({ message: "Bình luận và các bình luận con đã được xóa" });
    } catch (error) {
        console.error("Error in /comments/:id DELETE:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;