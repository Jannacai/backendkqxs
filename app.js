const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const { default: helmet } = require('helmet');
const compression = require('compression');
const path = require("path");
const routes = require('./src/routers/index');
const fs = require("fs");
require('dotenv').config();

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// Tạo thư mục uploads nếu chưa tồn tại
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
    console.log("Created uploads directory:", uploadsDir);
}

// Phục vụ file tĩnh từ thư mục uploads
app.use("/uploads", express.static(uploadsDir, {
    setHeaders: (res, filePath) => {
        console.log("Serving file:", filePath);
        res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
    },
}));

// Ngăn cache cho tất cả request
app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

// Khởi tạo middleware
app.use(cors());
app.use(compression());
app.use(morgan('dev'));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 20,
    minPoolSize: 2,
})
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));


routes(app);

module.exports = app;