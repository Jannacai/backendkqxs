const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Post = require("../../models/posts.models");
const User = require("../../models/users.models");

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

const restrictToAdmin = (req, res, next) => {
    if (req.user.role !== "ADMIN") {
        console.log("Access denied: User is not ADMIN", req.user);
        return res.status(403).json({ error: "Only admins can perform this action" });
    }
    next();
};

const isValidUrl = (url) => {
    try {
        new URL(url);
        return url.startsWith('http');
    } catch {
        return false;
    }
};

router.post("/", authenticate, restrictToAdmin, async (req, res) => {
    console.log("POST /api/posts called");
    console.log("Request body:", req.body);

    const { title, description, img } = req.body;

    if (!title || !description) {
        console.log("Missing title or description");
        return res.status(400).json({ error: "Title and description are required" });
    }

    if (img && !isValidUrl(img)) {
        console.log("Invalid image URL");
        return res.status(400).json({ error: "Invalid image URL" });
    }

    try {
        const post = new Post({
            title,
            description,
            img: img || "",
            author: req.user.userId,
        });
        console.log("Saving post to database:", post);
        await post.save();
        console.log("Post saved successfully:", post);
        res.status(201).json(post);
    } catch (error) {
        console.error("Error saving post:", error.message);
        if (error.name === "ValidationError") {
            return res.status(400).json({ error: "Invalid data", details: error.errors });
        }
        res.status(500).json({ error: "Failed to save post", details: error.message });
    }
});

router.get("/", async (req, res) => {
    try {
        const now = new Date();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        const posts = await Post.find({ createdAt: { $gte: twoDaysAgo } }).sort({ createdAt: -1 });
        res.status(200).json(posts);
        console.log("Posts retrieved:", posts);
    } catch (error) {
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