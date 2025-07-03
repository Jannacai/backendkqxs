"use strict";

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io = null;

function initializeWebSocket(server) {
    if (io) {
        console.warn("Socket.IO server already initialized");
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
        const token = socket.handshake.query.token;
        if (!token || token === "undefined" || token === "") {
            console.error(`Socket.IO: No valid token provided for client ${socket.id}`);
            return next(new Error("Authentication error: Missing or invalid token"));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.userId;
            console.log(`Socket.IO client connected: ${socket.userId} (Client ID: ${socket.id})`);
            next();
        } catch (err) {
            console.error(`Socket.IO: Token verification failed for client ${socket.id}:`, err.message);
            return next(new Error(`Authentication error: ${err.message}`));
        }
    });

    io.on("connection", (socket) => {
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

        socket.on("joinLeaderboard", () => {
            socket.join("leaderboard");
            console.log(`Client ${socket.userId} joined leaderboard room`);
        });

        socket.on("joinEventFeed", () => {
            socket.join("eventFeed");
            console.log(`Client ${socket.userId} joined eventFeed room`);
        });

        socket.on("joinEvent", (eventId) => {
            socket.join(`event:${eventId}`);
            console.log(`Client ${socket.userId} joined room event:${eventId}`);
        });

        socket.on("disconnect", () => {
            console.log(`Socket.IO client disconnected: ${socket.userId}`);
        });

        socket.on("error", (error) => {
            console.error(`Socket.IO error for client ${socket.userId}:`, error.message);
        });
    });

    console.log("Socket.IO server initialized");
}

function broadcastComment({ type, data, room, postId, eventId }) {
    if (!io) {
        console.warn("Socket.IO server not initialized, skipping broadcast");
        return;
    }
    if (room) {
        io.to(room).emit(type, data);
        console.log(`Broadcasted ${type} to room ${room}`);
    } else if (postId) {
        io.to(`post:${postId}`).emit(type, data);
        console.log(`Broadcasted ${type} to room post:${postId}`);
    } else if (eventId) {
        io.to(`event:${eventId}`).emit(type, data);
        console.log(`Broadcasted ${type} to room event:${eventId}`);
    } else {
        io.to("chat").emit(type, data);
        console.log(`Broadcasted ${type} to chat room`);
    }
}

module.exports = { initializeWebSocket, broadcastComment, io };