const { createClient } = require('redis');

// Singleton client và lock để tránh xung đột
let redisClient;
const redisLock = { initializing: false };
const pendingPromises = []; // Queue cho các lời gọi getRedisClient

// Hàm tính thời gian backoff theo exponential backoff
const calculateBackoff = (attempt) => Math.min(1000 * Math.pow(2, attempt - 1), 8000); // Max 8s

const initializeRedis = async (retryCount = 3) => {
    if (redisLock.initializing) {
        // Nếu đang khởi tạo, chờ và trả về client khi sẵn sàng
        return new Promise((resolve) => {
            pendingPromises.push(resolve);
        });
    }

    if (!redisClient) {
        redisLock.initializing = true;
        try {
            redisClient = createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                socket: {
                    connectTimeout: 10000,
                    keepAlive: 1000,
                    reconnectStrategy: (retries) => {
                        if (retries >= retryCount) {
                            console.error('Redis reconnect failed after max retries');
                            return false; // Dừng reconnect
                        }
                        return calculateBackoff(retries + 1);
                    },
                },
            });

            redisClient.on('error', (err) => console.error('Redis Client Error:', err));
            redisClient.on('reconnecting', () => console.log('Redis client attempting to reconnect...'));
            redisClient.on('ready', () => {
                console.log('Redis client connected or reconnected successfully');
                // Giải quyết các lời gọi đang chờ
                while (pendingPromises.length) {
                    pendingPromises.shift()(redisClient);
                }
            });

            for (let attempt = 1; attempt <= retryCount; attempt++) {
                try {
                    await redisClient.connect();
                    console.log(`Redis client connected on attempt ${attempt}`);
                    break;
                } catch (err) {
                    console.error(`Attempt ${attempt} failed to connect to Redis:`, err.message);
                    if (attempt === retryCount) {
                        throw new Error(`Failed to connect to Redis after ${retryCount} attempts`);
                    }
                    await new Promise(resolve => setTimeout(resolve, calculateBackoff(attempt)));
                }
            }
        } catch (err) {
            console.error('Failed to initialize Redis:', err);
            throw err; // Ném lỗi để caller xử lý
        } finally {
            redisLock.initializing = false;
        }
    }

    return redisClient;
};

const getRedisClient = async (commandTimeout = 5000) => {
    if (!redisClient || !redisClient.isOpen) {
        try {
            await initializeRedis();
        } catch (err) {
            console.error('getRedisClient failed:', err.message);
            throw new Error('Redis unavailable, please try again later');
        }
    }

    if (!redisClient.isReady) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return getRedisClient(commandTimeout);
    }

    redisClient.options.commandTimeout = commandTimeout;
    return redisClient;
};

const closeRedis = async () => {
    if (redisClient && redisClient.isOpen) {
        try {
            await redisClient.quit();
            console.log('Redis client disconnected');
        } catch (err) {
            console.error('Failed to disconnect Redis:', err);
        } finally {
            redisClient = null;
        }
    }
};

// Đóng Redis khi server dừng
process.on('SIGINT', async () => {
    await closeRedis();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeRedis();
    process.exit(0);
});

module.exports = { getRedisClient, initializeRedis, closeRedis };