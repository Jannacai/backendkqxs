"use strict";

const { Server } = require("socket.io");

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

    io.on("connection", (socket) => {
        // Tự động tham gia phòng public khi kết nối
        socket.join("public");
        console.log(`Socket.IO client connected: Client ID: ${socket.id}`);

        socket.on("joinChat", () => {
            socket.join("chat");
            console.log(`Client ${socket.id} joined chat room`);
        });

        socket.on("joinPost", (postId) => {
            socket.join(`post:${postId}`);
            console.log(`Client ${socket.id} joined room post:${postId}`);
        });

        socket.on("joinLotteryFeed", () => {
            socket.join("lotteryFeed");
            console.log(`Client ${socket.id} joined lotteryFeed room`);
        });

        socket.on("joinLeaderboard", () => {
            socket.join("leaderboard");
            console.log(`Client ${socket.id} joined leaderboard room`);
        });

        socket.on("joinEventFeed", () => {
            socket.join("eventFeed");
            console.log(`Client ${socket.id} joined eventFeed room`);
        });

        socket.on("joinEvent", (eventId) => {
            socket.join(`event:${eventId}`);
            console.log(`Client ${socket.id} joined room event:${eventId}`);
        });

        socket.on("disconnect", () => {
            console.log(`Socket.IO client disconnected: ${socket.id}`);
        });

        socket.on("error", (error) => {
            console.error(`Socket.IO error for client ${socket.id}:`, error.message);
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
        io.to("public").emit(type, data); // Sử dụng phòng public thay vì chat
        console.log(`Broadcasted ${type} to public room`);
    }
}

module.exports = { initializeWebSocket, broadcastComment, io };