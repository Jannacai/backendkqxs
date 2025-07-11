// "use strict";

// const express = require("express");
// const router = express.Router();
// const jwt = require("jsonwebtoken");
// const bcrypt = require("bcryptjs");
// const userModel = require("../../models/users.models");
// const nodemailer = require("nodemailer");
// const rateLimit = require("express-rate-limit");

// // Rate limiting cho login
// const loginLimiter = rateLimit({
//     windowMs: 15 * 60 * 1000, // 15 phút
//     max: 5, // Tối đa 5 yêu cầu mỗi IP
//     message: "Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau 15 phút.",
// });

// // Rate limiting cho register
// const registerLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000, // 1 giờ
//     max: 3, // Tối đa 3 yêu cầu mỗi IP
//     message: "Quá nhiều yêu cầu đăng ký. Vui lòng thử lại sau 1 giờ.",
// });

// // Rate limiting cho forgot-password
// const forgotPasswordLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000, // 1 giờ
//     max: 3, // Tối đa 3 yêu cầu mỗi IP
//     message: "Quá nhiều yêu cầu gửi link đặt lại mật khẩu. Vui lòng thử lại sau 1 giờ.",
// });

// // Rate limiting cho reset-password
// const resetPasswordLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000, // 1 giờ
//     max: 5, // Tối đa 5 yêu cầu mỗi IP
//     message: "Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau 1 giờ.",
// });

// // Kiểm tra biến môi trường
// let transporter;
// if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
//     transporter = nodemailer.createTransport({
//         service: "gmail",
//         pool: true, // Sử dụng connection pool
//         maxConnections: 5,
//         auth: {
//             user: process.env.EMAIL_USER,
//             pass: process.env.EMAIL_PASS,
//         },
//     });

//     transporter.verify((error, success) => {
//         if (error) {
//             console.error("Nodemailer configuration error:", error.message);
//         } else {
//             console.log("Nodemailer ready to send emails");
//         }
//     });
// } else {
//     console.error("Missing EMAIL_USER or EMAIL_PASS in environment variables. Email functionality will be disabled.");
// }

// // Middleware để validate dữ liệu
// const validateRegisterInput = (req, res, next) => {
//     const { username, password } = req.body;
//     if (!username || !password) {
//         return res.status(400).json({ error: "Username and password are required" });
//     }
//     if (username.length < 3) {
//         return res.status(400).json({ error: "Username must be at least 3 characters long" });
//     }
//     if (password.length < 6) {
//         return res.status(400).json({ error: "Password must be at least 6 characters long" });
//     }
//     next();
// };

// // Middleware xác thực token
// const authenticate = (req, res, next) => {
//     const authHeader = req.headers.authorization;
//     if (!authHeader) {
//         return res.status(401).json({ error: "Authorization header is missing" });
//     }

//     const token = authHeader.split(" ")[1];
//     if (!token) {
//         return res.status(401).json({ error: "Token is missing" });
//     }

//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
//         console.log('Decoded JWT:', decoded); // Debug token
//         if (!decoded.userId && !decoded._id) {
//             return res.status(401).json({ error: "Token không chứa ID người dùng" });
//         }
//         req.user = {
//             id: decoded.userId || decoded._id,
//             userId: decoded.userId || decoded._id,
//             role: decoded.role,
//         };
//         next();
//     } catch (error) {
//         console.error('Authentication error:', error.message);
//         return res.status(401).json({ error: "Invalid token" });
//     }
// };

// // GET: Lấy thông tin người dùng
// router.get("/me", authenticate, async (req, res) => {
//     try {
//         const user = await userModel.findById(req.user.id).select("-password -refreshTokens");
//         if (!user) {
//             return res.status(404).json({ error: "User not found" });
//         }
//         res.status(200).json(user);
//     } catch (error) {
//         console.error("Error in /me:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// // GET: Lấy tất cả người dùng
// router.get("/", async (req, res) => {
//     try {
//         const results = await userModel.find().select("-password -refreshTokens");
//         res.status(200).json(results);
//     } catch (error) {
//         console.error("Error in /:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// // POST: Đăng ký người dùng
// router.post("/register", registerLimiter, validateRegisterInput, async (req, res) => {
//     const { username, email, fullname, password } = req.body;
//     const deviceInfo = req.headers["user-agent"] || "unknown";

//     try {
//         const existingUser = await userModel.findOne({ $or: [{ username }, { email }] });
//         if (existingUser) {
//             return res.status(400).json({ error: existingUser.username === username ? "Username already exists" : "Email already exists" });
//         }

//         const user = new userModel({ username, email, fullname, password });
//         const accessToken = jwt.sign(
//             { userId: user._id, role: user.role },
//             process.env.JWT_SECRET,
//             { expiresIn: "12h" }
//         );

//         const refreshToken = jwt.sign(
//             { userId: user._id },
//             process.env.JWT_REFRESH_SECRET,
//             { expiresIn: "30d" }
//         );

//         user.refreshTokens = [{
//             token: refreshToken,
//             deviceInfo,
//             expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
//         }];
//         await user.save();

//         res.status(201).json({
//             message: "User registered successfully",
//             accessToken,
//             refreshToken,
//             user: { id: user._id, username: user.username, email: user.email, role: user.role },
//         });
//     } catch (error) {
//         console.error("Error in /register:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// // POST: Đăng nhập
// router.post("/login", loginLimiter, validateRegisterInput, async (req, res) => {
//     const { username, password } = req.body;
//     const deviceInfo = req.headers["user-agent"] || "unknown";

//     try {
//         const user = await userModel.findOne({ username });
//         if (!user) {
//             return res.status(400).json({ error: "Username not found" });
//         }

//         if (user.lockUntil && user.lockUntil > new Date()) {
//             return res.status(403).json({ error: "Tài khoản bị khóa. Vui lòng thử lại sau." });
//         }

//         const isMatch = await user.comparePassword(password);
//         if (!isMatch) {
//             user.failedLoginAttempts += 1;
//             if (user.failedLoginAttempts >= 5) {
//                 user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // Khóa 15 phút
//                 user.failedLoginAttempts = 0;
//             }
//             await user.save();
//             return res.status(400).json({ error: "Incorrect password" });
//         }

//         user.failedLoginAttempts = 0;
//         user.lockUntil = null;

//         const accessToken = jwt.sign(
//             { userId: user._id, role: user.role },
//             process.env.JWT_SECRET,
//             { expiresIn: "12h" }
//         );

//         const refreshToken = jwt.sign(
//             { userId: user._id },
//             process.env.JWT_REFRESH_SECRET,
//             { expiresIn: "30d" }
//         );

//         user.refreshTokens.push({
//             token: refreshToken,
//             deviceInfo,
//             expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
//         });
//         await user.save();

//         res.status(200).json({
//             accessToken,
//             refreshToken,
//             user: { id: user._id, username: user.username, email: user.email, role: user.role },
//         });
//     } catch (error) {
//         console.error("Error in /login:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// // POST: Quên mật khẩu
// router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
//     const { email } = req.body;

//     if (!email) {
//         return res.status(400).json({ error: "Email is required" });
//     }

//     if (!transporter) {
//         return res.status(500).json({ error: "Email service is not configured" });
//     }

//     try {
//         const user = await userModel.findOne({ email });
//         if (!user) {
//             return res.status(400).json({ error: "Email not found" });
//         }

//         const resetToken = jwt.sign(
//             { userId: user._id },
//             process.env.JWT_SECRET,
//             { expiresIn: "1h" }
//         );

//         const resetLink = `${process.env.FRONTEND_URL}/reset-password`;
//         await transporter.sendMail({
//             from: process.env.EMAIL_USER,
//             to: email,
//             subject: "Đặt lại mật khẩu",
//             html: `<p>Nhấn vào liên kết sau và nhập mã: ${resetToken}</p><a href="${resetLink}">Đặt lại mật khẩu</a><p>Mã có hiệu lực trong 1 giờ.</p>`,
//         });

//         res.status(200).json({ message: "Link đặt lại mật khẩu đã được gửi tới email của bạn" });
//     } catch (error) {
//         console.error("Error in /forgot-password:", error.message);
//         res.status(500).json({ error: "Không thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau." });
//     }
// });

// // POST: Đặt lại mật khẩu
// router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
//     const { token, newPassword } = req.body;

//     if (!token) {
//         return res.status(400).json({ error: "Token is required" });
//     }

//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
//         const user = await userModel.findById(decoded.userId);

//         if (!user) {
//             return res.status(400).json({ error: "Invalid or expired token" });
//         }

//         if (!newPassword) {
//             return res.status(200).json({ message: "Token is valid" });
//         }

//         if (newPassword.length < 8) {
//             return res.status(400).json({ error: "New password must be at least 8 characters long" });
//         }

//         user.password = newPassword;
//         user.refreshTokens = [];
//         await user.save();

//         res.status(200).json({ message: "Password reset successfully" });
//     } catch (error) {
//         console.error("Error in /reset-password:", error.message);
//         if (error.name === "TokenExpiredError") {
//             return res.status(400).json({ error: "Token has expired" });
//         }
//         res.status(400).json({ error: "Invalid token" });
//     }
// });

// // POST: Cấp lại access token
// router.post("/refresh-token", async (req, res) => {
//     const { refreshToken } = req.body;
//     const deviceInfo = req.headers["user-agent"] || "unknown";

//     if (!refreshToken) {
//         return res.status(400).json({ error: "Refresh token is required" });
//     }

//     try {
//         const user = await userModel.findOne({ "refreshTokens.token": refreshToken });
//         if (!user) {
//             return res.status(403).json({ error: "Invalid refresh token" });
//         }

//         const tokenData = user.refreshTokens.find((t) => t.token === refreshToken);
//         if (!tokenData || tokenData.expiresAt < new Date()) {
//             return res.status(403).json({ error: "Invalid or expired refresh token" });
//         }

//         const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
//         if (decoded.userId !== user._id.toString()) {
//             return res.status(403).json({ error: "Invalid refresh token" });
//         }

//         user.refreshTokens = user.refreshTokens.filter((t) => t.token !== refreshToken);
//         const newRefreshToken = jwt.sign(
//             { userId: user._id },
//             process.env.JWT_REFRESH_SECRET,
//             { expiresIn: "30d" }
//         );
//         user.refreshTokens.push({
//             token: newRefreshToken,
//             deviceInfo,
//             expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
//         });

//         const accessToken = jwt.sign(
//             { userId: user._id, role: user.role },
//             process.env.JWT_SECRET,
//             { expiresIn: "12h" }
//         );

//         await user.save();
//         res.status(200).json({ accessToken, newRefreshToken });
//     } catch (error) {
//         console.error("Error in /refresh-token:", error.message);
//         if (error.name === "TokenExpiredError") {
//             return res.status(403).json({ error: "Refresh token expired" });
//         }
//         res.status(403).json({ error: "Invalid refresh token" });
//     }
// });

// // POST: Đăng xuất
// router.post("/logout", async (req, res) => {
//     const { refreshToken } = req.body;

//     if (!refreshToken) {
//         return res.status(400).json({ error: "Refresh token is required" });
//     }

//     try {
//         const user = await userModel.findOne({ "refreshTokens.token": refreshToken });
//         if (user) {
//             user.refreshTokens = user.refreshTokens.filter((t) => t.token !== refreshToken);
//             await user.save();
//         }
//         res.status(200).json({ message: "Logged out successfully" });
//     } catch (error) {
//         console.error("Error in /logout:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });
// module.exports = router;