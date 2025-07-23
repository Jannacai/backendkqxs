const { createClient } = require('redis');

class RedisManager {
    constructor() {
        this.client = null;
        this.connectionPromise = null;
        this.HEARTBEAT_INTERVAL = 30000; // 30s
    }

    async initialize(retryCount = 5, delayMs = 3000) {
        if (this.connectionPromise) return this.connectionPromise;

        this.connectionPromise = (async () => {
            for (let attempt = 1; attempt <= retryCount; attempt++) {
                try {
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

                    this.client.on('error', (err) =>
                        console.error('Redis Client Error:', err));
                    this.client.on('ready', () =>
                        this.startHeartbeat());

                    await this.client.connect();
                    console.log('Redis connected successfully');
                    return this.client;
                } catch (err) {
                    console.error(`Attempt ${attempt} failed:`, err.message);
                    if (attempt === retryCount) throw err;
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

    async close() {
        clearInterval(this.heartbeatInterval);
        if (this.client?.isOpen) await this.client.quit();
        this.client = null;
        this.connectionPromise = null;
    }
}

// Singleton instance
const redisManager = new RedisManager();

process.on('SIGINT', async () => {
    await redisManager.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await redisManager.close();
    process.exit(0);
});

module.exports = redisManager;