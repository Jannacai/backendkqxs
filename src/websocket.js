"use strict";

const { Server } = require("socket.io");
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const moment = require('moment-timezone');
const redisManager = require('./utils/redisMT');

let io = null;
let guestCount = 0;

const lotteryRooms = new Map();
const lotterySubscribers = new Map();
const redisSubscribers = new Map(); // Map to store Redis subscribers for each room

// Add throttling mechanism for backend broadcasts
const broadcastThrottles = new Map();

// Cleanup old throttles periodically
setInterval(() => {
    const now = Date.now();
    const maxAge = 60000; // 1 minute
    for (const [key, timestamp] of broadcastThrottles.entries()) {
        if (now - timestamp > maxAge) {
            broadcastThrottles.delete(key);
        }
    }
}, 30000); // Clean every 30 seconds

function getProvinceName(tinh) {
    const provinceMap = {
        'kon-tum': 'Kon Tum',
        'khanh-hoa': 'Khánh Hòa',
        'hue': 'Thừa Thiên Huế',
        'phu-yen': 'Phú Yên',
        'dak-lak': 'Đắk Lắk',
        'quang-nam': 'Quảng Nam',
        'da-nang': 'Đà Nẵng',
        'binh-dinh': 'Bình Định',
        'quang-tri': 'Quảng Trị',
        'quang-binh': 'Quảng Bình',
        'gia-lai': 'Gia Lai',
        'ninh-thuan': 'Ninh Thuận',
        'quang-ngai': 'Quảng Ngãi',
        'dak-nong': 'Đắk Nông',
    };
    return provinceMap[tinh] || tinh;
}

function initializeWebSocket(server) {
    if (io) {
        console.warn("Socket.IO server already initialized");
        return;
    }

    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        transports: ['websocket'],
        pingTimeout: 60000,
        pingInterval: 25000,
    });

    io.on("connection", async (socket) => {
        const token = socket.handshake.query.token;
        let userId = null;

        try {
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
                userId = decoded.userId || decoded.id;
            }
        } catch (err) {
            console.log('Guest connected (invalid token)');
        }

        socket.join("public");
        console.log(`Socket.IO client connected: ${socket.id}`);

        socket.on("joinLotteryRoom", async (data) => {
            const { station, date } = data;
            const roomKey = `kqxs:${station}:${date}`;

            socket.join(roomKey);

            if (!lotterySubscribers.has(roomKey)) {
                lotterySubscribers.set(roomKey, new Set());
            }
            lotterySubscribers.get(roomKey).add(socket.id);

            console.log(`Client ${socket.id} joined lottery room: ${roomKey}`);
            console.log(`Room subscribers count: ${lotterySubscribers.get(roomKey).size}`);

            // Tạo Redis subscriber cho realtime updates
            const redis = await redisManager.getClient();
            const subscriber = redis.duplicate();

            try {
                await subscriber.connect();

                // Subscribe to Redis channel for realtime updates
                await subscriber.subscribe(`xsmt:${date}`, async (message) => {
                    try {
                        const { prizeType, prizeData, drawDate, tentinh, tinh, year, month } = JSON.parse(message);

                        // Chỉ xử lý updates cho đúng date
                        if (drawDate === date) {
                            // Throttling mechanism for backend broadcasts
                            const throttleKey = `${station}:${date}`;
                            const now = Date.now();
                            const lastBroadcast = broadcastThrottles.get(throttleKey) || 0;
                            const throttleDelay = 50; // Reduced to 50ms for faster real-time updates

                            if (now - lastBroadcast < throttleDelay) {
                                return; // Skip this broadcast
                            }
                            broadcastThrottles.set(throttleKey, now);

                            // Lấy dữ liệu hiện tại từ Redis
                            const redisKey = `kqxs:${station}:${date}:${tinh}`;
                            const existingData = await redis.hGetAll(redisKey);

                            // Cập nhật dữ liệu mới
                            await redis.hSet(redisKey, prizeType, JSON.stringify(prizeData));
                            await redis.expire(redisKey, 86400);

                            // Cập nhật latest data
                            let latestData = await redis.get(`${redisKey}:latest`);
                            let fullData = latestData ? JSON.parse(latestData) : {
                                drawDate: date,
                                station,
                                tentinh: getProvinceName(tinh),
                                tinh: tinh,
                                year: new Date().getFullYear(),
                                month: new Date().getMonth() + 1,
                                dayOfWeek: new Date(date.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
                                lastUpdated: 0,
                                eightPrizes_0: '...',
                                sevenPrizes_0: '...',
                                sixPrizes_0: '...',
                                sixPrizes_1: '...',
                                sixPrizes_2: '...',
                                fivePrizes_0: '...',
                                fourPrizes_0: '...',
                                fourPrizes_1: '...',
                                fourPrizes_2: '...',
                                fourPrizes_3: '...',
                                fourPrizes_4: '...',
                                fourPrizes_5: '...',
                                fourPrizes_6: '...',
                                threePrizes_0: '...',
                                threePrizes_1: '...',
                                secondPrize_0: '...',
                                firstPrize_0: '...',
                                specialPrize_0: '...',
                            };

                            fullData[prizeType] = prizeData;
                            fullData.lastUpdated = Date.now();

                            await redis.set(`${redisKey}:latest`, JSON.stringify(fullData));
                            await redis.expire(`${redisKey}:latest`, 86400);

                            // Broadcast qua WebSocket
                            await broadcastLotteryUpdate(station, date);
                        }
                    } catch (error) {
                        console.error('Error processing Redis update:', error);
                    }
                });

                // Store subscriber for cleanup
                if (!redisSubscribers.has(roomKey)) {
                    redisSubscribers.set(roomKey, new Set());
                }
                redisSubscribers.get(roomKey).add(subscriber);

            } catch (error) {
                console.error('Error setting up Redis subscriber:', error);
            }

            // Send initial data if available
            try {
                const redis = await redisManager.getClient();
                const provincesByDay = {
                    0: ['kon-tum', 'khanh-hoa', 'hue'],
                    1: ['phu-yen', 'hue'],
                    2: ['dak-lak', 'quang-nam'],
                    3: ['da-nang', 'khanh-hoa'],
                    4: ['binh-dinh', 'quang-tri', 'quang-binh'],
                    5: ['gia-lai', 'ninh-thuan'],
                    6: ['da-nang', 'quang-ngai', 'dak-nong'],
                };
                const dayOfWeek = new Date().getDay();
                const provinces = provincesByDay[dayOfWeek] || provincesByDay[6];

                const initialData = await Promise.all(provinces.map(async (tinh) => {
                    const redisKey = `kqxs:xsmt:${date}:${tinh}`;
                    let existingData = await redis.hGetAll(redisKey);
                    const latestData = await redis.get(`${redisKey}:latest`);
                    const metadata = JSON.parse((await redis.hGet(`${redisKey}:meta`, 'metadata')) || '{}');

                    console.log(`Debug - Redis data for ${redisKey}:`);
                    console.log(`existingData keys:`, Object.keys(existingData));
                    console.log(`existingData values:`, existingData);
                    console.log(`latestData exists:`, !!latestData);

                    const provinceMap = {
                        'kon-tum': { tentinh: 'Kon Tum', tinh: 'kon-tum' },
                        'khanh-hoa': { tentinh: 'Khánh Hòa', tinh: 'khanh-hoa' },
                        'hue': { tentinh: 'Thừa Thiên Huế', tinh: 'hue' },
                        'phu-yen': { tentinh: 'Phú Yên', tinh: 'phu-yen' },
                        'dak-lak': { tentinh: 'Đắk Lắk', tinh: 'dak-lak' },
                        'quang-nam': { tentinh: 'Quảng Nam', tinh: 'quang-nam' },
                        'da-nang': { tentinh: 'Đà Nẵng', tinh: 'da-nang' },
                        'binh-dinh': { tentinh: 'Bình Định', tinh: 'binh-dinh' },
                        'quang-tri': { tentinh: 'Quảng Trị', tinh: 'quang-tri' },
                        'quang-binh': { tentinh: 'Quảng Bình', tinh: 'quang-binh' },
                        'gia-lai': { tentinh: 'Gia Lai', tinh: 'gia-lai' },
                        'ninh-thuan': { tentinh: 'Ninh Thuận', tinh: 'ninh-thuan' },
                        'quang-ngai': { tentinh: 'Quảng Ngãi', tinh: 'quang-ngai' },
                        'dak-nong': { tentinh: 'Đắk Nông', tinh: 'dak-nong' },
                    };

                    const province = provinceMap[tinh] || { tentinh: tinh, tinh };

                    let data = {
                        drawDate: date,
                        station,
                        dayOfWeek: new Date(date.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
                        tentinh: province.tentinh,
                        tinh: province.tinh,
                        year: metadata.year || new Date().getFullYear(),
                        month: metadata.month || new Date().getMonth() + 1,
                        lastUpdated: metadata.lastUpdated || 0,
                        eightPrizes_0: '...',
                        sevenPrizes_0: '...',
                        sixPrizes_0: '...',
                        sixPrizes_1: '...',
                        sixPrizes_2: '...',
                        fivePrizes_0: '...',
                        fourPrizes_0: '...',
                        fourPrizes_1: '...',
                        fourPrizes_2: '...',
                        fourPrizes_3: '...',
                        fourPrizes_4: '...',
                        fourPrizes_5: '...',
                        fourPrizes_6: '...',
                        threePrizes_0: '...',
                        threePrizes_1: '...',
                        secondPrize_0: '...',
                        firstPrize_0: '...',
                        specialPrize_0: '...',
                    };

                    // Ưu tiên đọc từ existingData trước
                    if (existingData && Object.keys(existingData).length > 0) {
                        console.log(`Reading from existingData for ${redisKey}:`, existingData);
                        for (const key of Object.keys(existingData)) {
                            if (data.hasOwnProperty(key)) {
                                try {
                                    const parsedValue = JSON.parse(existingData[key]);
                                    data[key] = parsedValue;
                                    console.log(`Set ${key} = ${parsedValue}`);
                                } catch (e) {
                                    console.error(`Error parsing Redis data for ${redisKey}, key ${key}:`, e);
                                    data[key] = existingData[key];
                                }
                            }
                        }
                    } else if (latestData) {
                        // Nếu không có existingData, thử đọc từ latestData
                        try {
                            const parsedLatest = JSON.parse(latestData);
                            console.log(`Reading from latestData for ${redisKey}:`, parsedLatest);
                            for (const key of Object.keys(parsedLatest)) {
                                if (data.hasOwnProperty(key)) {
                                    data[key] = parsedLatest[key];
                                }
                            }
                            data.lastUpdated = parsedLatest.lastUpdated || Date.now();
                        } catch (e) {
                            console.error(`Error parsing latestData for ${redisKey}:`, e);
                        }
                    }

                    console.log(`Final data for ${tinh}:`, data);
                    return data;
                }));

                socket.emit('LOTTERY_INITIAL', {
                    type: 'LOTTERY_INITIAL',
                    payload: initialData,
                    timestamp: Date.now()
                });
                console.log(`Sent initial data for room ${roomKey}:`, initialData);
                console.log(`Initial data length:`, initialData.length);
                console.log(`Initial data structure:`, initialData.map(item => ({ tinh: item.tinh, tentinh: item.tentinh, specialPrize_0: item.specialPrize_0 })));
            } catch (error) {
                console.error('Error sending initial kqxs data:', error);
                socket.emit('LOTTERY_ERROR', {
                    type: 'LOTTERY_ERROR',
                    payload: { message: 'Không thể lấy dữ liệu ban đầu từ Redis' }
                });
            }
        });

        socket.on("leaveLotteryRoom", (data) => {
            const { station, date } = data;
            const roomKey = `kqxs:${station}:${date}`;

            socket.leave(roomKey);
            console.log(`Client ${socket.id} left lottery room: ${roomKey}`);

            const subscribers = lotterySubscribers.get(roomKey);
            if (subscribers) {
                subscribers.delete(socket.id);
                if (subscribers.size === 0) {
                    lotterySubscribers.delete(roomKey);

                    // Unsubscribe from Redis channel when no more clients
                    const redisSubs = redisSubscribers.get(roomKey);
                    if (redisSubs) {
                        redisSubs.forEach(subscriber => {
                            subscriber.unsubscribe(`lottery:${roomKey.split(':')[1]}:updates`);
                        });
                        redisSubscribers.delete(roomKey);
                        console.log(`Unsubscribed from Redis channel for room ${roomKey}`);
                    }
                }
            }
        });

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

        socket.on("joinRewardFeed", () => {
            socket.join("rewardFeed");
            console.log(`Client ${socket.id} joined rewardFeed room`);
        });

        socket.on("joinRoom", (room) => {
            socket.join(room);
            console.log(`Client ${socket.id} joined room ${room}`);
        });

        socket.on("joinPrivateRoom", (roomId) => {
            socket.join(roomId);
            console.log(`Client ${socket.id} joined private room ${roomId}`);
        });

        socket.on('disconnect', () => {
            console.log(`Socket.IO client disconnected: ${socket.id}, reason: ${socket.disconnectReason}`);

            // Cleanup lottery subscribers
            lotterySubscribers.forEach((subscribers, roomKey) => {
                if (subscribers.has(socket.id)) {
                    subscribers.delete(socket.id);
                    if (subscribers.size === 0) {
                        lotterySubscribers.delete(roomKey);

                        // Unsubscribe from Redis channel when no more clients
                        const redisSubs = redisSubscribers.get(roomKey);
                        if (redisSubs) {
                            redisSubs.forEach(subscriber => {
                                subscriber.unsubscribe(`lottery:${roomKey.split(':')[1]}:updates`);
                            });
                            redisSubscribers.delete(roomKey);
                            console.log(`Unsubscribed from Redis channel for room ${roomKey}`);
                        }
                    }
                }
            });
        });

        socket.on("error", (error) => {
            console.error(`Socket.IO error for client ${socket.id}:`, error.message);
        });
    });

    console.log("Socket.IO server initialized");
}

async function broadcastLotteryUpdate(station, date, data) {
    const roomKey = `kqxs:${station}:${date}`;

    // Lấy tất cả tỉnh cho ngày này
    const dayOfWeek = new Date(date.split('-').reverse().join('-')).getDay();
    const provincesByDay = {
        0: ['kon-tum', 'khanh-hoa', 'hue'],
        1: ['phu-yen', 'hue'],
        2: ['dak-lak', 'quang-nam'],
        3: ['da-nang', 'khanh-hoa'],
        4: ['binh-dinh', 'quang-tri', 'quang-binh'],
        5: ['gia-lai', 'ninh-thuan'],
        6: ['da-nang', 'quang-ngai', 'dak-nong'],
    };

    const provinces = provincesByDay[dayOfWeek] || provincesByDay[6];

    // Lấy dữ liệu của tất cả tỉnh từ Redis
    const allData = [];
    for (const tinh of provinces) {
        const redisKey = `kqxs:${station}:${date}:${tinh}`;
        const redis = await redisManager.getClient();
        const existingData = await redis.hGetAll(redisKey);
        const latestData = await redis.get(`${redisKey}:latest`);

        let provinceData = {
            drawDate: date,
            station,
            tentinh: getProvinceName(tinh),
            tinh: tinh,
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1,
            dayOfWeek: new Date(date.split('-').reverse().join('-')).toLocaleString('vi-VN', { weekday: 'long' }),
            lastUpdated: 0,
            eightPrizes_0: '...',
            sevenPrizes_0: '...',
            sixPrizes_0: '...',
            sixPrizes_1: '...',
            sixPrizes_2: '...',
            fivePrizes_0: '...',
            fourPrizes_0: '...',
            fourPrizes_1: '...',
            fourPrizes_2: '...',
            fourPrizes_3: '...',
            fourPrizes_4: '...',
            fourPrizes_5: '...',
            fourPrizes_6: '...',
            threePrizes_0: '...',
            threePrizes_1: '...',
            secondPrize_0: '...',
            firstPrize_0: '...',
            specialPrize_0: '...',
        };

        // Ưu tiên đọc từ existingData trước
        if (existingData && Object.keys(existingData).length > 0) {
            for (const key of Object.keys(existingData)) {
                if (provinceData.hasOwnProperty(key)) {
                    try {
                        const parsedValue = JSON.parse(existingData[key]);
                        provinceData[key] = parsedValue;
                    } catch (e) {
                        console.error(`Error parsing Redis data for ${redisKey}, key ${key}:`, e);
                        provinceData[key] = existingData[key];
                    }
                }
            }
        } else if (latestData) {
            try {
                const parsedLatest = JSON.parse(latestData);
                for (const key of Object.keys(parsedLatest)) {
                    if (provinceData.hasOwnProperty(key)) {
                        provinceData[key] = parsedLatest[key];
                    }
                }
                provinceData.lastUpdated = parsedLatest.lastUpdated || Date.now();
            } catch (e) {
                console.error(`Error parsing latestData for ${redisKey}:`, e);
            }
        }

        allData.push(provinceData);
    }

    // Broadcast to room
    await broadcastLotteryUpdateToRoom(roomKey, allData);
}

async function broadcastLotteryUpdateToRoom(roomKey, updateData) {
    if (!io) {
        console.error('Socket.IO server not initialized');
        return;
    }

    const room = io.to(roomKey);
    const subscribers = lotterySubscribers.get(roomKey);
    const subscribersCount = subscribers ? subscribers.size : 0;

    if (subscribersCount === 0) {
        return;
    }

    const payload = {
        type: 'LOTTERY_UPDATE',
        payload: updateData,
        timestamp: Date.now()
    };

    room.emit('LOTTERY_UPDATE', payload);

    // Persist to Redis for new clients
    try {
        const redis = await redisManager.getClient();
        await redis.set(`lottery:${roomKey}:latest`, JSON.stringify(payload));
        await redis.expire(`lottery:${roomKey}:latest`, 86400);
    } catch (error) {
        console.error('Error persisting lottery data to Redis:', error);
    }
}

function broadcastLotteryError(station, date, error) {
    if (!io) {
        console.warn("Socket.IO server not initialized");
        return;
    }

    const roomKey = `kqxs:${station}:${date}`;
    io.to(roomKey).emit('LOTTERY_ERROR', {
        type: 'LOTTERY_ERROR',
        payload: { message: error },
        timestamp: Date.now()
    });
}

function getLotterySubscribersCount(station, date) {
    const roomKey = `kqxs:${station}:${date}`;
    const subscribers = lotterySubscribers.get(roomKey);
    return subscribers ? subscribers.size : 0;
}

function broadcastComment({ type, data, room, postId, eventId }) {
    if (!io) {
        console.warn("Socket.IO server not initialized, skipping broadcast");
        return;
    }

    if (room) {
        io.to(room).emit(type, { ...data, roomId: room });
        console.log(`Broadcasted ${type} to room ${room}`);
    } else if (postId) {
        io.to(`post:${postId}`).emit(type, data);
        console.log(`Broadcasted ${type} to room post:${postId}`);
    } else if (eventId) {
        io.to(`event:${eventId}`).emit(type, data);
        console.log(`Broadcasted ${type} to room event:${eventId}`);
    } else {
        io.to("public").emit(type, data);
        console.log(`Broadcasted ${type} to public room`);
    }
}

module.exports = {
    initializeWebSocket,
    broadcastComment,
    broadcastLotteryUpdate,
    broadcastLotteryError,
    getLotterySubscribersCount,
    io
};