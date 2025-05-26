const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Post = require("../../models/posts.models");
const multer = require("multer");
const fs = require("fs").promises;
const path = require("path");

const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error("Token verification error:", error.message);
        return res.status(401).json({ error: "Invalid token" });
    }
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        const filename = Date.now() + path.extname(file.originalname);
        cb(null, filename);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|png|jpg|svg|webp/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error("Chỉ chấp nhận file JPEG hoặc PNG"));
    },
}).single("img");

const handleMulterError = (req, res, next) => {
    upload(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
};

router.post("/", authenticate, handleMulterError, async (req, res) => {
    const { title, description } = req.body;
    let imgBase64 = undefined;

    if (req.file) {
        const fileBuffer = await fs.readFile(req.file.path);
        imgBase64 = `data:${req.file.mimetype};base64,${fileBuffer.toString("base64")}`;
        await fs.unlink(req.file.path);
    }

    if (!title || !description) {
        return res.status(400).json({ error: "Title and description are required" });
    }

    try {
        const post = new Post({
            title,
            description,
            img: imgBase64,
            author: req.user.userId,
        });
        await post.save();
        res.status(201).json(post);
    } catch (error) {
        console.error("Error saving post:", error.message);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
});

router.get("/", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const posts = await Post.find().skip(skip).limit(limit).sort({ createdAt: -1 });
        const total = await Post.countDocuments();
        res.status(200).json({ posts, total, page, limit });
    } catch (error) {
        console.error("Error fetching posts:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ error: "Post not found" });
        }
        res.status(200).json(post);
    } catch (error) {
        console.error("Error fetching post:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;