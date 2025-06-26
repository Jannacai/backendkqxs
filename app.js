const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const http = require("http");
const { default: helmet } = require("helmet");
const compression = require("compression");
const path = require("path");
const routes = require("./src/routers/index");
const fs = require("fs");
const WebSocket = require("ws");
require("dotenv").config();
const telegramWebhookRouter = require("./src/routers/routestelegram");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.set("trust proxy", 1);

// Tạo thư mục uploads nếu chưa tồn tại
const uploadsDir = path.join(__dirname, "Uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log("Đã tạo thư mục uploads tại:", uploadsDir);
}

// Phục vụ file tĩnh từ thư mục uploads
app.use(
    "/uploads",
    express.static(uploadsDir, {
        setHeaders: (res, filePath) => {
            res.setHeader("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "http://localhost:3000");
        },
    })
);

// Khởi tạo middleware
app.use(
    cors({
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST", "DELETE", "PUT"],
        credentials: true,
    })
);
app.use(compression());
app.use(morgan("dev", { skip: (req, res) => res.statusCode < 400 }));
app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Kết nối MongoDB
mongoose
    .connect(process.env.MONGODB_URI, {
        maxPoolSize: 20,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
    })
    .then(() => console.log("Đã kết nối với MongoDB"))
    .catch((err) => console.error("Lỗi kết nối MongoDB:", err));

// Khởi tạo WebSocket
wss.on("connection", (ws, req) => {
    const token = new URLSearchParams(req.url.slice(2)).get("token");
    if (!token) {
        ws.close(4000, "Không có token");
        return;
    }

    try {
        const jwt = require("jsonwebtoken");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        ws.userId = decoded.userId;
        console.log("Client WebSocket đã kết nối:", ws.userId);

        ws.on("message", (message) => {
            console.log("Tin nhắn WebSocket nhận được:", message.toString());
        });

        ws.on("close", () => {
            console.log("Client WebSocket đã ngắt kết nối:", ws.userId);
        });

        ws.on("error", (error) => {
            console.error("Lỗi WebSocket client:", error.message);
        });
    } catch (err) {
        console.error("Lỗi xác thực WebSocket:", err.message);
        ws.close(4001, "Token không hợp lệ");
    }
});

// Hàm broadcast bình luận
const broadcastComment = (comment) => {
    console.log("Đang broadcast bình luận:", comment._id);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.userId) {
            console.log("Gửi đến client:", client.userId);
            client.send(JSON.stringify({ type: "NEW_COMMENT", data: comment }));
        }
    });
};

// Lưu broadcastComment vào app
app.set("broadcastComment", broadcastComment);

// Gắn route xử lý webhook Telegram
app.use("/webhook", telegramWebhookRouter);

// Thiết lập webhook cho Telegram khi server khởi động
const setTelegramWebhook = async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN || "7789171652:AAEmz2GIO5WECWE2K1o-d6bve3vdvFctLCg";
    const WEBHOOK_URL = "https://backendkqxs.onrender.com/webhook";

    try {
        const { default: fetch } = await import("node-fetch");
        const url = `https://api.telegram.org/bot${token}/setWebhook?url=${WEBHOOK_URL}`;
        const response = await fetch(url, { timeout: 5000 });
        const result = await response.json();
        if (result.ok) {
            console.log("Webhook đã được thiết lập thành công:", WEBHOOK_URL);
        } else {
            console.error("Lỗi thiết lập webhook:", result);
        }
    } catch (error) {
        console.error("Lỗi khi thiết lập webhook:", error.message);
    }
};

// Gọi hàm thiết lập webhook khi server khởi động
setTelegramWebhook();

// Gắn các route khác
routes(app);

// Xử lý lỗi toàn cục để tránh crash
app.use((err, req, res, next) => {
    console.error("Lỗi chưa xử lý:", err.message);
    res.status(500).send("Lỗi máy chủ");
});

module.exports = { app, server };