const { createClient } = require('redis');

let redisClient;
const redisLock = {};

const initializeRedis = async (retryCount = 3, delayMs = 2000) => {
    if (!redisClient && !redisLock.initializing) {
        redisLock.initializing = true;
        try {
            redisClient = createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                socket: {
                    connectTimeout: 10000,
                    keepAlive: 1000,
                },
            });

            redisClient.on('error', (err) => console.error('Redis Client Error:', err));
            redisClient.on('reconnecting', () => console.log('Redis client attempting to reconnect...'));
            redisClient.on('ready', () => console.log('Redis client reconnected successfully'));

            for (let attempt = 1; attempt <= retryCount; attempt++) {
                try {
                    await redisClient.connect();
                    console.log('Redis client connected');
                    break;
                } catch (err) {
                    console.error(`Attempt ${attempt} failed to connect to Redis:`, err.message);
                    if (attempt === retryCount) throw err;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        } catch (err) {
            console.error('Failed to connect to Redis after retries:', err);
        } finally {
            redisLock.initializing = false;
        }
    } else if (!redisClient) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return initializeRedis();
    }
    return redisClient;
};

const getRedisClient = async () => {
    if (!redisClient || !redisClient.isOpen) {
        await initializeRedis();
    }
    if (!redisClient.isReady) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return getRedisClient();
    }
    redisClient.options.commandTimeout = 5000; // 5 giây
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

process.on('SIGINT', async () => {
    await closeRedis();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeRedis();
    process.exit(0);
});

module.exports = { getRedisClient, initializeRedis, closeRedis };