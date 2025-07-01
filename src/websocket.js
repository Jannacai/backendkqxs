"use strict";

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io = null;

function initializeWebSocket(server) {
    if (io) {
        return;
    }
    io = new Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL || "http://localhost:3000",
            methods: ["GET", "POST"],
            credentials: true,
        },
    });

    io.use((socket, next) => {
        const token = socket.handshake.query.token || socket.handshake.auth.token;
        console.log('Socket.IO token:', token); // Debug
        if (!token) {
            console.log('No token provided, disconnecting client:', socket.id);
            socket.disconnect(true);
            return next(new Error('Authentication error: Token missing'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.userId || decoded._id;
            console.log(`Socket.IO client connected: ${socket.userId}`);
            next();
        } catch (err) {
            console.error('Token verification error:', err.message);
            socket.disconnect(true);
            return next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on("connection", (socket) => {
        console.log(`Socket.IO client connected: ${socket.userId}`);

        socket.on("joinChat", () => {
            socket.join("chat");
            console.log(`Client ${socket.userId} joined chat room`);
        });

        socket.on("joinPost", (postId) => {
            socket.join(`post:${postId}`);
            console.log(`Client ${socket.userId} joined room post:${postId}`);
        });

        socket.on("joinLotteryFeed", () => {
            socket.join("lotteryFeed");
            console.log(`Client ${socket.userId} joined lotteryFeed room`);
        });

        socket.on("disconnect", (reason) => {
            console.log(`Socket.IO client disconnected: ${socket.userId}, reason: ${reason}`);
        });

        socket.on("error", (error) => {
            console.error(`Socket.IO error for client ${socket.userId}:`, error.message);
        });
    });

    console.log("Socket.IO server initialized");
}

function broadcastComment({ type, data, room, postId }) {
    if (!io) {
        console.warn("Socket.IO server not initialized, skipping broadcast");
        return;
    }
    if (room) {
        io.to(room).emit(type, data);
        console.log(`Broadcasted ${type} to room ${room}:`, data);
    } else if (postId) {
        io.to(`post:${postId}`).emit(type, data);
        console.log(`Broadcasted ${type} to room post:${postId}:`, data);
    } else {
        io.to("chat").emit(type, data);
        console.log(`Broadcasted ${type} to chat room:`, data);
    }
}

module.exports = { initializeWebSocket, broadcastComment, io };