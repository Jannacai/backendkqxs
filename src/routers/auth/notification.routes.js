const express = require("express");
const router = express.Router();
const notificationModel = require("../../models/notification.models");
const { authenticate } = require("./auth.routes");

// GET: Lấy thông báo của người dùng
router.get("/", authenticate, async (req, res) => {
    try {
        const notifications = await notificationModel
            .find({ userId: req.user.userId })
            .populate("taggedBy", "username fullname")
            .populate("commentId", "content")
            .sort({ createdAt: -1 });
        res.status(200).json(notifications);
    } catch (error) {
        console.error("Error in /notifications:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST: Đánh dấu thông báo đã đọc
router.post("/:id/read", authenticate, async (req, res) => {
    try {
        const notification = await notificationModel.findOne({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!notification) {
            return res.status(404).json({ error: "Thông báo không tồn tại" });
        }
        notification.isRead = true;
        await notification.save();
        res.status(200).json(notification);
    } catch (error) {
        console.error("Error in /notifications/:id/read:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST: Đánh dấu tất cả thông báo đã đọc
router.post("/read-all", authenticate, async (req, res) => {
    try {
        await notificationModel.updateMany(
            { userId: req.user.userId, isRead: false },
            { isRead: true }
        );
        res.status(200).json({ message: "Đã đánh dấu tất cả thông báo đã đọc" });
    } catch (error) {
        console.error("Error in /notifications/read-all:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// DELETE: Xóa thông báo
router.delete("/:id", authenticate, async (req, res) => {
    try {
        const notification = await notificationModel.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.userId,
        });
        if (!notification) {
            return res.status(404).json({
                error: "Thông báo không tồn tại" });
        }
        await notification.deleteOne();
            res.status(200).json({ message: "Thông báo đã được xóa" });
        } catch (error) {
            console.error("Error in /notifications/:id DELETE:", error.message);
            res.status(500).json({ error: "Internal Server Error" });
        }
    });

module.exports = router;