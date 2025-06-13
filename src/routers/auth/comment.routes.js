const express = require("express");
const router = express.Router();
const commentModel = require("../../models/comments.models");
const userModel = require("../../models/users.models.js");
const notificationModel = require("../../models/notification.models.js");
const { authenticate } = require("./auth.routes.js");
const { getRedisClient } = require("../../utils/redis.js");

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

router.get("/", async (req, res) => {
    try {
        const redisClient = await getRedisClient();
        const cacheKey = 'comments';
        const cachedComments = await redisClient.get(cacheKey);

        if (cachedComments) {
            console.log('Serving comments from Redis cache');
            return res.status(200).json(JSON.parse(cachedComments));
        }

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
                ],
                options: { sort: { createdAt: -1 } },
            });

        await redisClient.setEx(cacheKey, 60, JSON.stringify(comments));
        console.log('Cached comments in Redis');

        res.status(200).json(comments);
    } catch (error) {
        console.error("Error in /comments:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/", authenticate, async (req, res) => {
    const { content, parentComment, taggedUsers } = req.body;
    const io = req.app.get('io');

    if (!content || !content.trim()) {
        return res.status(400).json({ error: "Nội dung bình luận là bắt buộc" });
    }

    try {
        let depth = 0;
        let parent = null;
        if (parentComment) {
            parent = await commentModel.findById(parentComment);
            if (!parent) {
                return res.status(404).json({ error: "Bình luận cha không tồn tại" });
            }
            depth = parent.depth + 1;
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
            parent.childComments.push(comment._id);
            await parent.save();
        }

        const redisClient = await getRedisClient();
        await redisClient.del('comments');

        const populatedComment = await commentModel
            .findById(comment._id)
            .populate("createdBy", "username fullname role")
            .populate("taggedUsers", "username fullname role");

        // Tạo thông báo cho người dùng được tag
        const notifications = [];
        if (validTaggedUsers.length > 0) {
            for (const taggedUserId of validTaggedUsers) {
                if (taggedUserId.toString() !== req.user.userId.toString()) {
                    const taggedUser = await userModel.findById(taggedUserId);
                    const notification = new notificationModel({
                        userId: taggedUserId,
                        commentId: comment._id,
                        taggedBy: req.user.userId,
                        content: `${populatedComment.createdBy.fullname} đã nhắc đến bạn trong một bình luận: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`,
                        isRead: false,
                    });
                    await notification.save();
                    const populatedNotification = await notificationModel
                        .findById(notification._id)
                        .populate("taggedBy", "username fullname")
                        .populate("commentId", "content");
                    notifications.push(populatedNotification);
                }
            }
        }

        // Tạo thông báo cho người tạo bình luận cha
        if (parent) {
            const parentCreator = await userModel.findById(parent.createdBy);
            if (parentCreator && parentCreator._id.toString() !== req.user.userId.toString()) {
                const notification = new notificationModel({
                    userId: parent.createdBy,
                    commentId: comment._id,
                    taggedBy: req.user.userId,
                    content: `${populatedComment.createdBy.fullname} đã trả lời bình luận của bạn: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`,
                    isRead: false,
                });
                await notification.save();
                const populatedNotification = await notificationModel
                    .findById(notification._id)
                    .populate("taggedBy", "username fullname")
                    .populate("commentId", "content");
                notifications.push(populatedNotification);
            }
        }

        // Phát sự kiện newComment
        console.log('Emitting newComment:', populatedComment._id);
        io.emit('newComment', populatedComment);

        // Phát sự kiện newNotification cho từng thông báo
        notifications.forEach((notification) => {
            io.to(notification.userId.toString()).emit('newNotification', notification);
        });

        res.status(201).json(populatedComment);
    } catch (error) {
        console.error("Error in POST /comments:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post("/:id/like", authenticate, async (req, res) => {
    const io = req.app.get('io');
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

        const redisClient = await getRedisClient();
        await redisClient.del('comments');

        const populatedComment = await commentModel
            .findById(comment._id)
            .populate("createdBy", "username fullname role")
            .populate("taggedUsers", "username fullname role");

        io.emit('updateComment', populatedComment);

        res.status(200).json(populatedComment);
    } catch (error) {
        console.error("Error in /comments/:id/like:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.delete("/:id", authenticate, restrictToAdmin, async (req, res) => {
    const io = req.app.get('io');
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

        const redisClient = await getRedisClient();
        await redisClient.del('comments');

        io.emit('deleteComment', { commentId: comment._id });

        res.status(200).json({ message: "Bình luận và các bình luận con đã được xóa" });
    } catch (error) {
        console.error("Error in /comments/:id DELETE:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;