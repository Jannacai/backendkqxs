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

    io.on("connection", (socket) => {
        const token = socket.handshake.query.token;
        if (!token) {
            socket.disconnect(true);
            return;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.userId;
            console.log(`Socket.IO client connected: ${socket.userId}`);

            // Cho phép client join room chung cho bình luận (nếu không liên quan đến bài viết)
            socket.on("joinChat", () => {
                socket.join("chat");
                console.log(`Client ${socket.userId} joined chat room`);
            });

            // Cho phép client join room cho bài viết cụ thể
            socket.on("joinPost", (postId) => {
                socket.join(`post:${postId}`);
                console.log(`Client ${socket.userId} joined room post:${postId}`);
            });
        } catch (err) {
            console.error("Token verification error:", err.message);
            socket.disconnect(true);
            return;
        }

        socket.on("disconnect", () => {
            console.log(`Socket.IO client disconnected: ${socket.userId}`);
        });

        socket.on("error", (error) => {
            console.error(`Socket.IO error for client ${socket.userId}:`, error.message);
        });
    });

    console.log("Socket.IO server initialized");
}

function broadcastComment(message) {
    if (!io) {
        console.warn("Socket.IO server not initialized, skipping broadcast");
        return;
    }
    // Gửi đến room cụ thể nếu có postId, nếu không thì gửi đến room "chat" hoặc tất cả client
    if (message.postId) {
        io.to(`post:${message.postId}`).emit(message.type, message.data);
    } else {
        io.to("chat").emit(message.type, message.data); // Gửi đến room "chat" cho bình luận chung
    }
}

module.exports = { initializeWebSocket, broadcastComment };