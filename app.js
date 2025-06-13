const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const { default: helmet } = require('helmet');
const compression = require('compression');
const path = require('path');
const routes = require('./src/routers/index');
const fs = require('fs');
require('dotenv').config();

const telegramWebhookRouter = require('./src/routers/routestelegram');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// Tạo thư mục uploads nếu chưa tồn tại
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('Created uploads directory:', uploadsDir);
}

// Phục vụ file tĩnh từ thư mục uploads
app.use('/uploads', express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
        res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL);
    },
}));

// Khởi tạo middleware
app.use(cors({
    origin: process.env.FRONTEND_URL, // Giới hạn origin để tăng bảo mật
    methods: ['GET', 'POST', 'DELETE'], // Chỉ cho phép các phương thức cần thiết
}));
app.use(compression());
app.use(morgan('dev', { skip: (req, res) => res.statusCode < 400 })); // Chỉ log lỗi
app.use(helmet());
app.use(express.json({ limit: '100kb' })); // Giới hạn kích thước payload
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000, // Giảm thời gian chờ kết nối
})
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Gắn route xử lý webhook Telegram
app.use('/webhook', telegramWebhookRouter);

// Thiết lập webhook cho Telegram khi server khởi động
const setTelegramWebhook = async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN || '7789171652:AAEmz2GIO5WECWE2K1o-d6bve3vdvFctLCg';
    const WEBHOOK_URL = 'https://backendkqxs.onrender.com/webhook';

    try {
        const { default: fetch } = await import('node-fetch');
        const url = `https://api.telegram.org/bot${token}/setWebhook?url=${WEBHOOK_URL}`;
        const response = await fetch(url, { timeout: 5000 });
        const result = await response.json();
        if (result.ok) {
            console.log('Webhook đã được thiết lập thành công:', WEBHOOK_URL);
        } else {
            console.error('Lỗi thiết lập webhook:', result);
        }
    } catch (error) {
        console.error('Lỗi khi thiết lập webhook:', error.message);
    }
};

// Gọi hàm thiết lập webhook khi server khởi động
setTelegramWebhook();

// Gắn các route khác
routes(app);

// Xử lý lỗi toàn cục để tránh crash
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).send('Internal Server Error');
});

module.exports = app;