// routes/auth.js
"use strict";

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const userModel = require("../../models/users.models");

// Middleware để validate dữ liệu
const validateRegisterInput = (req, res, next) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
    }
    if (username.length < 3) {
        return res.status(400).json({ error: "Username must be at least 3 characters long" });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters long" });
    }
    next();
};

// Middleware xác thực token
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: "Authorization header is missing" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Token is missing" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid token" });
    }
};

// GET: Lấy thông tin người dùng (trừ password)
router.get("/me", authenticate, async (req, res) => {
    try {
        console.log("Fetching user with ID:", req.user.userId);
        const user = await userModel.findById(req.user.userId).select("-password");
        if (!user) {
            console.log("User not found for ID:", req.user.userId);
            return res.status(404).json({ error: "User not found" });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error("Error in /me:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET: Lấy tất cả người dùng (thêm middleware xác thực nếu cần)
router.get("/", async (req, res) => {
    try {
        const results = await userModel.find().select("-password");
        res.status(200).json(results);
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST: Đăng ký người dùng
router.post("/register", validateRegisterInput, async (req, res) => {
    const { username, fullname, password } = req.body;

    try {
        const existingUser = await userModel.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: "Username already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new userModel({ username, fullname, password });
        await user.save();

        // Tạo access token
        const accessToken = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "15m" } // Hết hạn sau 15 phút
        );

        // Tạo refresh token
        const refreshToken = jwt.sign(
            { userId: user._id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: "7d" } // Hết hạn sau 7 ngày
        );

        // Lưu refresh token vào database
        user.refreshToken = refreshToken;
        await user.save();

        res.status(201).json({
            message: "User registered successfully",
            accessToken,
            refreshToken,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST: Đăng nhập
router.post("/login", validateRegisterInput, async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await userModel.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: "Username not found" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: "Incorrect password" });
        }

        // Tạo access token
        const accessToken = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "15m" }
        );

        // Tạo refresh token
        const refreshToken = jwt.sign(
            { userId: user._id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: "7d" }
        );

        // Lưu refresh token vào database
        user.refreshToken = refreshToken;
        await user.save();

        res.status(200).json({
            accessToken,
            refreshToken,
            user: { id: user._id, username: user.username, role: user.role },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST: Cấp lại access token bằng refresh token
router.post("/refresh-token", async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ error: "Refresh token is required" });
    }

    try {
        // Tìm user có refresh token này
        const user = await userModel.findOne({ refreshToken });
        if (!user) {
            return res.status(403).json({ error: "Invalid refresh token" });
        }

        // Xác minh refresh token
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        if (decoded.userId !== user._id.toString()) {
            return res.status(403).json({ error: "Invalid refresh token" });
        }

        // Tạo access token mới
        const accessToken = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "15m" }
        );

        res.status(200).json({ accessToken });
    } catch (error) {
        console.error("Error in refresh-token:", error.message);
        if (error.name === "TokenExpiredError") {
            return res.status(403).json({ error: "Refresh token expired" });
        }
        res.status(403).json({ error: "Invalid refresh token" });
    }
});

// POST: Đăng xuất
router.post("/logout", async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ error: "Refresh token is required" });
    }

    try {
        const user = await userModel.findOne({ refreshToken });
        if (user) {
            user.refreshToken = null;
            await user.save();
        }
        res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
        console.error("Error in logout:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;