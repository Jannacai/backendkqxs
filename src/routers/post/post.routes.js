// routes/posts.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Post = require("../../models/posts.models");
const multer = require("multer");
const fs = require("fs").promises; // Để đọc file
const path = require("path"); // Đảm bảo import path

// Middleware xác thực
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    console.log("Received token:", token);
    if (!token) {
        console.log("No token provided");
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        console.log("JWT_SECRET:", process.env.JWT_SECRET);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("Decoded token:", decoded);
        req.user = decoded;
        next();
    } catch (error) {
        console.error("Token verification error:", error.message);
        return res.status(401).json({ error: "Invalid token" });
    }
};

// Cấu hình multer để upload file
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        console.log("Saving file to uploads/");
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        const filename = Date.now() + path.extname(file.originalname);
        console.log("Generated filename:", filename);
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
        console.log("File type check - extname:", extname, "mimetype:", mimetype, "file:", file.originalname);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error("Chỉ chấp nhận file JPEG hoặc PNG"));
    },
}).single("img");

// Middleware để xử lý lỗi từ multer
const handleMulterError = (req, res, next) => {
    upload(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            console.log("Multer error:", err.message);
            return res.status(400).json({ error: err.message });
        } else if (err) {
            console.log("File filter error:", err.message);
            return res.status(400).json({ error: err.message });
        }
        next();
    });
};

// Đăng bài viết
router.post("/", authenticate, handleMulterError, async (req, res) => {
    console.log("POST /api/posts called");
    console.log("Request body:", req.body);
    console.log("Request file:", req.file);

    const { title, description } = req.body;
    let imgBase64 = undefined;

    if (req.file) {
        // Đọc file và chuyển thành Base64
        const fileBuffer = await fs.readFile(req.file.path);
        imgBase64 = `data:${req.file.mimetype};base64,${fileBuffer.toString("base64")}`;
        // Xóa file sau khi chuyển thành Base64 (không cần lưu file nữa)
        await fs.unlink(req.file.path);
    }

    if (!title || !description) {
        console.log("Missing title or description");
        return res.status(400).json({ error: "Title and description are required" });
    }

    try {
        console.log("req.user:", req.user);
        const post = new Post({
            title,
            description,
            img: imgBase64, // Lưu chuỗi Base64
            author: req.user.userId,
        });
        console.log("Saving post to database:", post);
        await post.save();
        console.log("Post saved successfully:", post);
        res.status(201).json(post);
    } catch (error) {
        console.error("Error saving post:", error.message);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
});

// Lấy tất cả bài viết
router.get("/", async (req, res) => {
    try {
        const posts = await Post.find();
        res.status(200).json(posts);
        console.log("Posts retrieved:", posts);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET: Lấy bài viết theo ID
// Nếu cần thêm rằng: Chỉ Khi đăng nhập mới xem được thì thêm: authenticate
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