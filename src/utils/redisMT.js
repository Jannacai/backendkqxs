const { createClient } = require('redis');

class RedisManager {
    constructor() {
        this.client = null;
        this.connectionPromise = null;
        this.HEARTBEAT_INTERVAL = 30000; // 30s
        this.MAX_RETRIES = 5;
        this.RETRY_DELAY = 3000;
        this.connectionAttempts = 0;
        this.lastReconnectTime = 0;
        this.RECONNECT_COOLDOWN = 10000; // 10s cooldown
    }

    async initialize(retryCount = 5, delayMs = 3000) {
        if (this.connectionPromise) return this.connectionPromise;

        // Kiểm tra cooldown để tránh spam reconnect
        const now = Date.now();
        if (now - this.lastReconnectTime < this.RECONNECT_COOLDOWN) {
            console.log('⏳ Đang trong cooldown, bỏ qua reconnect');
            return this.client;
        }

        this.connectionPromise = (async () => {
            for (let attempt = 1; attempt <= retryCount; attempt++) {
                try {
                    // Cleanup connection cũ nếu có
                    if (this.client?.isOpen) {
                        await this.client.quit();
                    }

                    this.client = createClient({
                        url: process.env.REDIS_URL || 'redis://localhost:6379',
                        socket: {
                            connectTimeout: 10000,
                            keepAlive: 1000,
                            reconnectStrategy: (retries) => {
                                if (retries > 15) return new Error('Max retries reached');
                                return Math.min(retries * 200, 5000);
                            },
                        },
                    });

                    this.client.on('error', (err) => {
                        console.error('Redis Client Error:', err);
                        this.handleConnectionError(err);
                    });

                    this.client.on('ready', () => {
                        console.log('✅ Redis connected successfully');
                        this.connectionAttempts = 0;
                        this.startHeartbeat();
                    });

                    this.client.on('end', () => {
                        console.log('🔌 Redis connection ended');
                        this.handleConnectionError(new Error('Connection ended'));
                    });

                    await this.client.connect();
                    this.lastReconnectTime = now;
                    return this.client;
                } catch (err) {
                    console.error(`Attempt ${attempt} failed:`, err.message);
                    this.connectionAttempts++;

                    if (attempt === retryCount) {
                        console.error('❌ Max Redis connection attempts reached');
                        throw err;
                    }

                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        })();

        return this.connectionPromise;
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(async () => {
            try {
                await this.client.ping();
            } catch (err) {
                console.error('Redis heartbeat failed:', err);
                this.reconnect();
            }
        }, this.HEARTBEAT_INTERVAL);
    }

    async reconnect() {
        clearInterval(this.heartbeatInterval);
        this.connectionPromise = null;
        if (this.client?.isOpen) await this.client.quit();
        this.client = null;
        return this.initialize();
    }

    async getClient() {
        if (!this.client || !this.client.isReady) {
            if (!this.connectionPromise) {
                await this.initialize();
            } else {
                await this.connectionPromise;
            }
        }
        return this.client;
    }

    // Thêm hàm để publish sự kiện SSE
    async publishSSEEvent(date, tinh, prizeType, prizeData, additionalData = {}) {
        try {
            const client = await this.getClient();
            const message = JSON.stringify({
                prizeType,
                prizeData,
                tentinh: additionalData.tentinh || '',
                tinh: additionalData.tinh || tinh,
                year: additionalData.year || new Date().getFullYear(),
                month: additionalData.month || new Date().getMonth() + 1,
                timestamp: Date.now()
            });

            await client.publish(`xsmt:${date}:${tinh}`, message);
            console.log(`📡 Published SSE event: ${prizeType} = ${prizeData} for ${tinh}`);
            return true;
        } catch (error) {
            console.error('❌ Lỗi publish SSE event:', error);
            return false;
        }
    }

    // Thêm hàm để cập nhật dữ liệu và publish sự kiện
    async updateLotteryData(date, tinh, prizeType, prizeData, additionalData = {}) {
        try {
            const client = await this.getClient();

            // Batch operations để tối ưu performance
            const pipeline = client.multi();

            // Cập nhật dữ liệu vào Redis
            pipeline.hSet(`kqxs:xsmt:${date}:${tinh}`, prizeType, JSON.stringify(prizeData));
            pipeline.expire(`kqxs:xsmt:${date}:${tinh}`, 86400);

            // Cập nhật metadata
            const metadata = {
                ...additionalData,
                lastUpdated: Date.now(),
            };
            pipeline.hSet(`kqxs:xsmt:${date}:${tinh}:meta`, 'metadata', JSON.stringify(metadata));
            pipeline.expire(`kqxs:xsmt:${date}:${tinh}:meta`, 86400);

            // Cập nhật latest data
            let latestData = await client.get(`kqxs:xsmt:${date}:${tinh}:latest`);
            let fullData = latestData ? JSON.parse(latestData) : {};
            fullData[prizeType] = prizeData;
            fullData.lastUpdated = Date.now();
            fullData.tentinh = additionalData.tentinh || '';
            fullData.tinh = additionalData.tinh || tinh;
            fullData.year = additionalData.year || new Date().getFullYear();
            fullData.month = additionalData.month || new Date().getMonth() + 1;

            pipeline.set(`kqxs:xsmt:${date}:${tinh}:latest`, JSON.stringify(fullData));
            pipeline.expire(`kqxs:xsmt:${date}:${tinh}:latest`, 86400);

            // Execute batch operations
            await pipeline.exec();

            // Publish sự kiện SSE
            await this.publishSSEEvent(date, tinh, prizeType, prizeData, additionalData);

            console.log(`✅ Updated lottery data: ${prizeType} = ${prizeData} for ${tinh}`);
            return true;
        } catch (error) {
            console.error('❌ Lỗi update lottery data:', error);

            // Thử reconnect nếu là connection error
            if (error.message.includes('ECONNRESET') || error.message.includes('ENOTFOUND')) {
                console.log('🔄 Thử reconnect Redis...');
                await this.reconnect();
            }

            return false;
        }
    }

    async close() {
        try {
            // Clear heartbeat interval
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }

            // Close Redis connection
            if (this.client?.isOpen) {
                await this.client.quit();
                console.log('🔌 Redis connection closed gracefully');
            }

            // Reset state
            this.client = null;
            this.connectionPromise = null;
            this.connectionAttempts = 0;
            this.lastReconnectTime = 0;
        } catch (error) {
            console.error('❌ Lỗi khi đóng Redis connection:', error);
        }
    }

    // Thêm method để cleanup memory
    cleanup() {
        this.close();
    }

    handleConnectionError(error) {
        console.error('Redis connection error:', error.message);
        if (this.connectionAttempts < this.MAX_RETRIES) {
            setTimeout(() => {
                this.reconnect();
            }, this.RETRY_DELAY);
        }
    }

    // Thêm method để lấy dữ liệu từ Redis (tương thích với xsmtLiveRoutes)
    async getData(key) {
        try {
            const client = await this.getClient();
            return await client.get(key);
        } catch (error) {
            console.error('❌ Lỗi getData:', error);
            return null;
        }
    }

    // Thêm method để lấy hash data
    async getHashData(key, field) {
        try {
            const client = await this.getClient();
            return await client.hGet(key, field);
        } catch (error) {
            console.error('❌ Lỗi getHashData:', error);
            return null;
        }
    }

    // Thêm method để lấy tất cả hash data
    async getAllHashData(key) {
        try {
            const client = await this.getClient();
            return await client.hGetAll(key);
        } catch (error) {
            console.error('❌ Lỗi getAllHashData:', error);
            return {};
        }
    }

    // Thêm method để set data với TTL
    async setDataWithTTL(key, value, ttl = 86400) {
        try {
            const client = await this.getClient();
            await client.setEx(key, ttl, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('❌ Lỗi setDataWithTTL:', error);
            return false;
        }
    }

    // Thêm method để set hash data
    async setHashData(key, field, value) {
        try {
            const client = await this.getClient();
            await client.hSet(key, field, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('❌ Lỗi setHashData:', error);
            return false;
        }
    }
}

// Singleton instance
const redisManager = new RedisManager();

process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, cleaning up...');
    await redisManager.cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, cleaning up...');
    await redisManager.cleanup();
    process.exit(0);
});

// Thêm handler cho uncaught exceptions
process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught Exception:', error);
    await redisManager.cleanup();
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    await redisManager.cleanup();
    process.exit(1);
});

module.exports = redisManager;