"use strict";

const express = require("express");
const router = express.Router();
const userModel = require("../../models/users.models");
const LotteryRegistration = require("../../models/lottery.models.js");
const { authenticate } = require("./auth.routes");
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const moment = require('moment-timezone');
const { broadcastComment } = require('../../websocket.js');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "db15lvbrw",
    api_key: process.env.CLOUDINARY_API_KEY || "685414381137448",
    api_secret: process.env.CLOUDINARY_API_SECRET || "6CNRrgEZQNt4GFggzkt0G5A8ePY",
});
console.log('Cloudinary Config:', {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? 'Set' : 'Not set',
    api_key: process.env.CLOUDINARY_API_KEY ? 'Set' : 'Not set',
    api_secret: process.env.CLOUDINARY_API_SECRET ? 'Set' : 'Not set',
});

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Chỉ hỗ trợ file JPEG hoặc PNG'));
    }
});

const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: "Chỉ admin mới có quyền truy cập" });
    }
    next();
};

router.get("/leaderboard", async (req, res) => {
    try {
        console.log('Fetching leaderboard with params:', req.query);
        const { limit = 50, sortBy = 'points' } = req.query;
        const sortOption = sortBy === 'winCount' ? { winCount: -1 } : { points: -1 };
        const users = await userModel
            .find()
            .select("fullname img points level titles winCount")
            .sort(sortOption)
            .limit(parseInt(limit));
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.status(200).json({ users });
    } catch (error) {
        console.error("Error in /users/leaderboard:", error.message);
        res.status(500).json({ error: "Không thể tải bảng xếp hạng", details: error.message });
    }
});

router.get("/stats", authenticate, isAdmin, async (req, res) => {
    try {
        const stats = {
            byPoints: await userModel.aggregate([
                {
                    $bucket: {
                        groupBy: "$points",
                        boundaries: [0, 500, 1500, 3000, 5000, 5001],
                        default: "5001+",
                        output: { count: { $sum: 1 } }
                    }
                }
            ]).exec() || [],
            byTitles: await userModel.aggregate([
                { $match: { titles: { $exists: true, $ne: [] } } },
                { $unwind: { path: "$titles", preserveNullAndEmptyArrays: true } },
                { $group: { _id: "$titles", count: { $sum: 1 } } },
                { $match: { _id: { $ne: null } } }
            ]).exec() || [],
            byLevel: await userModel.aggregate([
                { $match: { level: { $exists: true } } },
                { $group: { _id: "$level", count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]).exec() || []
        };
        res.status(200).json(stats);
    } catch (error) {
        console.error("Error in /users/stats:", error.message);
        res.status(500).json({ error: "Không thể tải thống kê", details: error.message });
    }
});

router.get("/filter", authenticate, isAdmin, async (req, res) => {
    try {
        const { pointsMin, pointsMax, level, title } = req.query;
        const query = {};
        if (pointsMin && pointsMax) {
            query.points = { $gte: parseInt(pointsMin), $lt: parseInt(pointsMax) };
        } else if (pointsMin) {
            query.points = { $gte: parseInt(pointsMin) };
        } else if (level) {
            query.level = parseInt(level);
        } else if (title) {
            query.titles = title;
        } else {
            return res.status(400).json({ error: "Cần cung cấp ít nhất một tham số: pointsMin, pointsMax, level, hoặc title" });
        }
        const users = await userModel
            .find(query)
            .select("-password -refreshTokens");
        res.status(200).json(users);
    } catch (error) {
        console.error("Error in /users/filter:", error.message);
        res.status(500).json({ error: "Không thể lọc người dùng" });
    }
});

router.get("/search", authenticate, async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: "Query là bắt buộc" });
        }
        const users = await userModel
            .find({
                fullname: { $regex: query, $options: "i" },
            })
            .select("-password -refreshTokens")
            .limit(5);
        res.status(200).json(users);
    } catch (error) {
        console.error("Error in /users/search:", error.message);
        res.status(500).json({ error: "Không thể tìm kiếm người dùng" });
    }
});

router.get("/", authenticate, isAdmin, async (req, res) => {
    try {
        const users = await userModel.find().select("-password -refreshTokens");
        res.status(200).json(users);
    } catch (error) {
        console.error("Error in /users:", error.message);
        res.status(500).json({ error: "Không thể tải danh sách người dùng" });
    }
});

router.get("/:id", authenticate, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await userModel.findById(id).select("-password -refreshTokens");
        if (!user) {
            return res.status(404).json({ error: "Người dùng không tồn tại" });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error("Error in /users/:id:", error.message);
        res.status(500).json({ error: "Không thể lấy thông tin người dùng" });
    }
});

router.put("/:id", authenticate, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { titles, level, points } = req.body;
        if (!titles && !level && points === undefined) {
            return res.status(400).json({ error: "Cần cung cấp ít nhất một trường để cập nhật: titles, level, hoặc points" });
        }
        const user = await userModel.findById(id);
        if (!user) {
            return res.status(404).json({ error: "Người dùng không tồn tại" });
        }
        const oldPoints = user.points;
        if (titles) user.titles = titles;
        if (level) user.level = level;
        if (points !== undefined) user.points = points;
        const updatedUser = await user.save();

        // Phát thông báo USER_UPDATED
        broadcastComment({
            type: 'USER_UPDATED',
            data: {
                _id: updatedUser._id,
                points: updatedUser.points,
                titles: updatedUser.titles,
                winCount: updatedUser.winCount,
                img: updatedUser.img,
                fullname: updatedUser.fullname
            },
            room: 'leaderboard'
        });
        broadcastComment({
            type: 'USER_UPDATED',
            data: {
                _id: updatedUser._id,
                points: updatedUser.points,
                titles: updatedUser.titles,
                winCount: updatedUser.winCount,
                img: updatedUser.img,
                fullname: updatedUser.fullname
            },
            room: 'lotteryFeed'
        });

        // Nếu điểm thay đổi, lưu thông báo phát thưởng và phát USER_REWARDED
        if (points !== undefined && points > oldPoints) {
            const pointsAwarded = points - oldPoints;
            const rewardNotification = new LotteryRegistration({
                userId: id,
                isReward: true,
                pointsAwarded,
                createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate()
            });
            await rewardNotification.save();

            broadcastComment({
                type: 'USER_REWARDED',
                data: {
                    userId: updatedUser._id,
                    username: updatedUser.username,
                    fullname: updatedUser.fullname,
                    img: updatedUser.img,
                    titles: updatedUser.titles,
                    points: updatedUser.points,
                    winCount: updatedUser.winCount,
                    pointsAwarded,
                    awardedAt: rewardNotification.createdAt
                },
                room: 'lotteryFeed'
            });
        }

        res.status(200).json({ message: "Cập nhật thông tin người dùng thành công", user: updatedUser });
    } catch (error) {
        console.error("Error in /users/:id:", error.message);
        res.status(500).json({ error: "Không thể cập nhật người dùng" });
    }
});

router.post("/reward", authenticate, isAdmin, async (req, res) => {
    try {
        const { userId, points } = req.body;
        if (!userId || !points || points <= 0) {
            return res.status(400).json({ error: "Cần cung cấp userId và số điểm hợp lệ" });
        }
        const user = await userModel.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "Người dùng không tồn tại" });
        }
        user.points = (user.points || 0) + points;
        const updatedUser = await user.save();

        // Lưu thông báo phát thưởng
        const rewardNotification = new LotteryRegistration({
            userId,
            isReward: true,
            pointsAwarded: points,
            createdAt: moment.tz('Asia/Ho_Chi_Minh').toDate()
        });
        await rewardNotification.save();

        // Phát thông báo USER_UPDATED
        broadcastComment({
            type: 'USER_UPDATED',
            data: {
                _id: updatedUser._id,
                points: updatedUser.points,
                titles: updatedUser.titles,
                winCount: updatedUser.winCount,
                img: updatedUser.img,
                fullname: updatedUser.fullname
            },
            room: 'leaderboard'
        });
        broadcastComment({
            type: 'USER_UPDATED',
            data: {
                _id: updatedUser._id,
                points: updatedUser.points,
                titles: updatedUser.titles,
                winCount: updatedUser.winCount,
                img: updatedUser.img,
                fullname: updatedUser.fullname
            },
            room: 'lotteryFeed'
        });

        // Phát thông báo USER_REWARDED
        broadcastComment({
            type: 'USER_REWARDED',
            data: {
                userId: updatedUser._id,
                username: updatedUser.username,
                fullname: updatedUser.fullname,
                img: updatedUser.img,
                titles: updatedUser.titles,
                points: updatedUser.points,
                winCount: updatedUser.winCount,
                pointsAwarded: points,
                awardedAt: rewardNotification.createdAt
            },
            room: 'lotteryFeed'
        });

        res.status(200).json({ message: "Phát thưởng thành công", user: updatedUser });
    } catch (error) {
        console.error("Error in /users/reward:", error.message);
        res.status(500).json({ error: "Không thể phát thưởng", details: error.message });
    }
});

router.delete("/:id", authenticate, isAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await userModel.findByIdAndDelete(id);
        if (!user) {
            return res.status(404).json({ error: "Người dùng không tồn tại" });
        }
        res.status(200).json({ message: "Xóa người dùng thành công" });
    } catch (error) {
        console.error("Error in /users/:id:", error.message);
        res.status(500).json({ error: "Không thể xóa người dùng" });
    }
});

router.post("/upload-avatar", authenticate, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.user || (!req.user.id && !req.user.userId)) {
            console.error('Invalid req.user:', req.user);
            return res.status(401).json({ error: "Không thể xác định người dùng. Vui lòng đăng nhập lại." });
        }
        if (!req.file) {
            return res.status(400).json({ error: "Không có file được tải lên" });
        }
        console.log('Uploading avatar to Cloudinary:', {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            userId: req.user.id || req.user.userId,
        });
        const bufferStream = require('stream').PassThrough();
        bufferStream.end(req.file.buffer);
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: 'avatars',
                    public_id: `${req.user.id || req.user.userId}_${Date.now()}`,
                    resource_type: 'image',
                    transformation: [{ width: 200, height: 200, crop: 'fill', quality: 'auto', fetch_format: 'auto' }],
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            bufferStream.pipe(uploadStream);
        });
        console.log('Cloudinary upload result:', {
            secure_url: result.secure_url,
            public_id: result.public_id,
        });
        const user = await userModel
            .findByIdAndUpdate(req.user.id || req.user.userId, { img: result.secure_url }, { new: true })
            .select("-password -refreshTokens");
        if (!user) {
            return res.status(404).json({ error: "Người dùng không tồn tại" });
        }
        const userUpdateData = {
            _id: user._id,
            points: user.points,
            titles: user.titles,
            winCount: user.winCount,
            img: user.img,
            fullname: user.fullname
        };
        broadcastComment({
            type: 'USER_UPDATED',
            data: userUpdateData,
            room: 'leaderboard'
        });
        broadcastComment({
            type: 'USER_UPDATED',
            data: userUpdateData,
            room: 'lotteryFeed'
        });
        res.status(200).json({ message: "Tải ảnh đại diện thành công", user });
    } catch (error) {
        console.error("Error uploading avatar to Cloudinary:", error.message);
        res.status(500).json({ error: "Không thể tải ảnh đại diện", details: error.message });
    }
});

module.exports = router;