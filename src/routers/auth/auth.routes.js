"use strict";

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const userModel = require("../../models/users.models");
const nodemailer = require("nodemailer");

// Kiểm tra biến môi trường
let transporter;
if ("xsmb.win.contact@gmail.com" && "fgqc wehk ypfa ykkf") {
    transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: "xsmb.win.contact@gmail.com",
            pass: "fgqc wehk ypfa ykkf",
        },
    });

    transporter.verify((error, success) => {
        if (error) {
            console.error("Nodemailer configuration error:", error.message);
        } else {
            console.log("Nodemailer ready to send emails");
        }
    });
} else {
    console.error("Missing EMAIL_USER or EMAIL_PASS in environment variables. Email functionality will be disabled.");
}

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

// GET: Lấy thông tin người dùng
router.get("/me", authenticate, async (req, res) => {
    try {
        const user = await userModel.findById(req.user.userId).select("-password -refreshTokens");
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error("Error in /me:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// GET: Lấy tất cả người dùng
router.get("/", async (req, res) => {
    try {
        const results = await userModel.find().select("-password -refreshTokens");
        res.status(200).json(results);
    } catch (error) {
        console.error("Error in /:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST: Đăng ký người dùng
router.post("/register", validateRegisterInput, async (req, res) => {
    const { username, email, fullname, password } = req.body;
    const deviceInfo = req.headers["user-agent"] || "unknown";

    try {
        const existingUser = await userModel.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: existingUser.username === username ? "Username already exists" : "Email already exists" });
        }

        const user = new userModel({ username, email, fullname, password });
        await user.save();

        const accessToken = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        const refreshToken = jwt.sign(
            { userId: user._id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: "7d" }
        );

        user.refreshTokens.push({
            token: refreshToken,
            deviceInfo,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        await user.save();

        res.status(201).json({
            message: "User registered successfully",
            accessToken,
            refreshToken,
            user: { id: user._id, username: user.username, email: user.email, role: user.role },
        });
    } catch (error) {
        console.error("Error in /register:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST: Đăng nhập
router.post("/login", validateRegisterInput, async (req, res) => {
    const { username, password } = req.body;
    const deviceInfo = req.headers["user-agent"] || "unknown";

    try {
        console.log("Login attempt for username:", username);
        const user = await userModel.findOne({ username });
        if (!user) {
            console.log("User not found:", username);
            return res.status(400).json({ error: "Username not found" });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            console.log("Password mismatch for username:", username);
            return res.status(400).json({ error: "Incorrect password" });
        }

        const accessToken = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        const refreshToken = jwt.sign(
            { userId: user._id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: "7d" }
        );

        user.refreshTokens.push({
            token: refreshToken,
            deviceInfo,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        await user.save();

        console.log("Login successful for username:", username);
        res.status(200).json({
            accessToken,
            refreshToken,
            user: { id: user._id, username: user.username, email: user.email, role: user.role },
        });
    } catch (error) {
        console.error("Error in /login:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST: Quên mật khẩu
router.post("/forgot-password", async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    if (!transporter) {
        return res.status(500).json({ error: "Email service is not configured" });
    }

    try {
        const user = await userModel.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: "Email not found" });
        }

        const resetToken = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        await transporter.sendMail({
            from: "xsmb.win.contact@gmail.com",
            to: email,
            subject: "Đặt lại mật khẩu",
            html: `<p>Nhấn vào liên kết sau để đặt lại mật khẩu của bạn:</p><a href="${resetLink}">${resetLink}</a><p>Liên kết này có hiệu lực trong 1 giờ. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>`,
        });

        // console.log(`Password reset email sent to: ${email}`);
        res.status(200).json({ message: "Link đặt lại mật khẩu đã được gửi tới email của bạn" });
    } catch (error) {
        console.error("Error in /forgot-password:", error.message);
        res.status(500).json({ error: "Không thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau." });
    }
});

// POST: Đặt lại mật khẩu
router.post("/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token) {
        return res.status(400).json({ error: "Token is required" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await userModel.findById(decoded.userId);

        if (!user) {
            return res.status(400).json({ error: "Invalid or expired token" });
        }

        // Nếu không có newPassword, chỉ kiểm tra token
        if (!newPassword) {
            return res.status(200).json({ message: "Token is valid" });
        }

        // Kiểm tra mật khẩu mới
        if (newPassword.length < 8) {
            return res.status(400).json({ error: "New password must be at least 8 characters long" });
        }

        user.password = newPassword;
        user.refreshTokens = []; // Vô hiệu hóa tất cả refresh tokens cũ
        await user.save();

        res.status(200).json({ message: "Password reset successfully" });
    } catch (error) {
        console.error("Error in /reset-password:", error.message);
        if (error.name === "TokenExpiredError") {
            return res.status(400).json({ error: "Token has expired" });
        }
        res.status(400).json({ error: "Invalid token" });
    }
});

// POST: Cấp lại access token
router.post("/refresh-token", async (req, res) => {
    const { refreshToken } = req.body;
    const deviceInfo = req.headers["user-agent"] || "unknown";

    if (!refreshToken) {
        return res.status(400).json({ error: "Refresh token is required" });
    }

    try {
        const user = await userModel.findOne({ "refreshTokens.token": refreshToken });
        if (!user) {
            return res.status(403).json({ error: "Invalid refresh token" });
        }

        const tokenData = user.refreshTokens.find((t) => t.token === refreshToken);
        if (!tokenData || tokenData.expiresAt < new Date()) {
            return res.status(403).json({ error: "Invalid or expired refresh token" });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        if (decoded.userId !== user._id.toString()) {
            return res.status(403).json({ error: "Invalid refresh token" });
        }

        user.refreshTokens = user.refreshTokens.filter((t) => t.token !== refreshToken);
        const newRefreshToken = jwt.sign(
            { userId: user._id },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: "7d" }
        );
        user.refreshTokens.push({
            token: newRefreshToken,
            deviceInfo,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const accessToken = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        await user.save();
        res.status(200).json({ accessToken, refreshToken: newRefreshToken });
    } catch (error) {
        console.error("Error in /refresh-token:", error.message);
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
        const user = await userModel.findOne({ "refreshTokens.token": refreshToken });
        if (user) {
            user.refreshTokens = user.refreshTokens.filter((t) => t.token !== refreshToken);
            await user.save();
        }
        res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
        console.error("Error in /logout:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


module.exports = {
    router,
    authenticate,
};