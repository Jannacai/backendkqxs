const WebSocket = require("ws");
const jwt = require("jsonwebtoken");

let wss = null;

function initializeWebSocket(server) {
    if (wss) {
        return;
    }
    wss = new WebSocket.Server({ server });

    wss.on("connection", (ws, req) => {
        const token = new URLSearchParams(req.url.slice(1)).get("token");
        if (!token) {
            ws.close(1008, "Token required");
            return;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            ws.userId = decoded.userId;
            console.log(`WebSocket client connected: ${ws.userId}`);
        } catch (err) {
            ws.close(1008, "Invalid token");
            return;
        }

        ws.on("close", () => {
            console.log(`WebSocket client disconnected: ${ws.userId}`);
        });

        ws.on("error", (error) => {
            console.error(`WebSocket error for client ${ws.userId}:`, error.message);
        });
    });

    console.log("WebSocket server initialized");
}

function broadcastComment(message) {
    if (!wss) {
        console.warn("WebSocket server not initialized, skipping broadcast");
        return;
    }
    const payload = JSON.stringify({
        type: message.type,
        data: message.data,
    });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(payload);
            } catch (err) {
                console.error(`Error sending to client ${client.userId}:`, err.message);
            }
        }
    });
}

module.exports = { initializeWebSocket, broadcastComment };