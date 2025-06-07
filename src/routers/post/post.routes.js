const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Post = require("../../models/posts.models");
const User = require("../../models/users.models");
const redis = require("redis");
const rateLimit = require("express-rate-limit");

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
});
redisClient.connect().catch((err) => console.error("Lỗi kết nối Redis:", err));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: "Quá nhiều yêu cầu, vui lòng thử lại sau.",
});

const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error("Token verification error:", error.message);
        return res.status(401).json({ error: "Invalid token" });
    }
};

const restrictToAdmin = (req, res, next) => {
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({ error: "Only admins can perform this action" });
    }
    next();
};

const isValidUrl = (url) => {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
        return url.startsWith("http") && imageExtensions.some((ext) => pathname.toLowerCase().endsWith(ext));
    } catch {
        return false;
    }
};

router.post("/", authenticate, restrictToAdmin, async (req, res) => {
    const { title, description, img, img2, category } = req.body;

    if (!title || !description) {
        return res.status(400).json({ error: "Title and description are required" });
    }

    if (img && !isValidUrl(img)) {
        return res.status(400).json({ error: "Invalid image URL for img" });
    }

    if (img2 && !isValidUrl(img2)) {
        return res.status(400).json({ error: "Invalid image URL for img2" });
    }

    const validCategories = ["Thể thao", "Đời sống"];
    if (category && !validCategories.includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
    }

    try {
        const post = new Post({
            title,
            description,
            img: img || "",
            img2: img2 || "", // Lưu img2
            author: req.user.userId,
            category: category || "Thể thao",
        });
        await post.save();

        const keys = await redisClient.keys("posts:recent:*");
        if (keys.length > 0) {
            await redisClient.del(keys);
            console.log("Cleared cache keys:", keys);
        }
        await redisClient.del(`post:${post._id}`);
        console.log("Cleared cache for post:", post._id);

        res.status(201).json(post);
    } catch (error) {
        console.error("Error saving post:", error.message);
        if (error.name === "ValidationError") {
            return res.status(400).json({ error: "Invalid data", details: error.errors });
        }
        res.status(500).json({ error: "Failed to save post", details: error.message });
    }
});

router.get("/", apiLimiter, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const cacheKey = `posts:recent:page:${page}:limit:${limit}`;
        console.log("Cache key:", cacheKey);
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            res.set('Cache-Control', 'no-store');
            return res.status(200).json(JSON.parse(cached));
        }

        const now = new Date();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        console.log("twoDaysAgo:", twoDaysAgo.toISOString(), "Now:", new Date().toISOString());
        const posts = await Post.find({ createdAt: { $gte: twoDaysAgo } })
            .select("title description img img2 createdAt category") // Thêm img2
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const totalPosts = await Post.countDocuments({ createdAt: { $gte: twoDaysAgo } });
        const response = {
            posts,
            totalPages: Math.ceil(totalPosts / limit),
            currentPage: page,
        };

        await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
        res.set('Cache-Control', 'no-store');
        res.status(200).json(response);
    } catch (error) {
        console.error("Error in GET /api/posts:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.get("/:id", apiLimiter, async (req, res) => {
    try {
        const cacheKey = `post:${req.params.id}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            res.set('Cache-Control', 'no-store');
            return res.status(200).json(JSON.parse(cached));
        }

        const post = await Post.findById(req.params.id)
            .select("title description img img2 createdAt category") // Thêm img2
            .lean();
        if (!post) {
            return res.status(404).json({ error: "Post not found" });
        }

        await redisClient.setEx(cacheKey, 3600, JSON.stringify(post));
        res.set('Cache-Control', 'no-store');
        res.status(200).json(post);
    } catch (error) {
        console.error("Error fetching post:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;