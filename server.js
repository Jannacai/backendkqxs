const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Authorization', 'Content-Type'],
    },
});

app.set('io', io);

io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId;
    if (userId) socket.join(userId);
    console.log('New Socket.IO connection:', socket.id, 'User:', userId);
    socket.on('disconnect', () => {
        console.log('Socket.IO disconnected:', socket.id);
    });
});

const port = process.env.PORT || 5000;
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

module.exports = { server, io };