const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const routes = require('./src/routers/index');
const fs = require('fs');
require('dotenv').config();

const telegramWebhookRouter = require('./src/routers/routestelegram');

const app = express();

app.set('trust proxy', 1);

// Tạo thư mục uploads nếu chưa tồn tại
const uploadsDir = path.join(__dirname, 'Uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log('Created uploads directory:', uploadsDir);
}

// Phục vụ file tĩnh từ thư mục uploads
app.use('/uploads', express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
        res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:3000');
    },
}));

// Khởi tạo middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'], // Thêm Cache-Control
}));
app.use(compression());
app.use(morgan('dev', { skip: (req, res) => res.statusCode < 400 }));
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
}).then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Gắn route xử lý webhook Telegram
app.use('/webhook', telegramWebhookRouter);

// Thiết lập webhook cho Telegram khi server khởi động
const setTelegramWebhook = async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN || '7789171652:AAEmz2GIO5WECWE2K1o-d6bve3vdvFctLCg';
    const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:5000/webhook';
    console.log('Setting Telegram webhook:', WEBHOOK_URL);
    try {
        const { default: fetch } = await import('node-fetch');
        const url = `https://api.telegram.org/bot${token}/setWebhook?url=${WEBHOOK_URL}`;
        const response = await fetch(url, { timeout: 5000 });
        const result = await response.json();
        if (result.ok) {
            console.log('Webhook set successfully:', WEBHOOK_URL);
        } else {
            console.error('Error setting webhook:', result);
        }
    } catch (error) {
        console.error('Error setting Telegram webhook:', error.message);
    }
};

setTelegramWebhook();

// Gắn các route khác
routes(app);

// Xử lý lỗi toàn cục để tránh crash
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).send('Internal Server Error');
});

module.exports = app;