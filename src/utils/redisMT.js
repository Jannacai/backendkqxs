const { createClient } = require('redis');

class RedisManager {
    constructor() {
        this.client = null;
        this.subscriber = null;
        this.connectionPromise = null;
        this.HEARTBEAT_INTERVAL = 30000; // 30s
        this.pubSubCallbacks = new Map();
    }

    async initialize(retryCount = 5, delayMs = 3000) {
        if (this.connectionPromise) return this.connectionPromise;

        this.connectionPromise = (async () => {
            for (let attempt = 1; attempt <= retryCount; attempt++) {
                try {
                    console.log(`=== REDIS INITIALIZATION ATTEMPT ${attempt}/${retryCount} ===`);
                    console.log(`Redis URL: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);

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

                    // Tạo subscriber riêng cho pub/sub
                    this.subscriber = this.client.duplicate();
                    console.log('Created Redis subscriber client');

                    this.client.on('error', (err) =>
                        console.error('Redis Client Error:', err));
                    this.client.on('ready', () => {
                        console.log('Redis Client connected and ready');
                        this.startHeartbeat();
                    });

                    this.subscriber.on('error', (err) =>
                        console.error('Redis Subscriber Error:', err));
                    this.subscriber.on('ready', () =>
                        console.log('Redis Subscriber connected and ready'));

                    await this.client.connect();
                    await this.subscriber.connect();
                    console.log('=== REDIS CONNECTION SUCCESSFUL ===');
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

    // Thêm method để subscribe Redis channel
    async subscribeToChannel(channel, callback) {
        try {
            if (!this.subscriber) {
                console.log('Creating subscriber client...');
                await this.initialize();
            }

            console.log(`Subscribing to Redis channel: ${channel}`);
            console.log(`Subscriber status:`, this.subscriber.isReady ? 'READY' : 'NOT READY');

            await this.subscriber.subscribe(channel, (message) => {
                console.log(`Received message from Redis channel ${channel}:`, message);
                try {
                    const data = JSON.parse(message);
                    console.log(`Parsed data from ${channel}:`, data);
                    callback(data);
                } catch (error) {
                    console.error(`Error parsing Redis message from ${channel}:`, error);
                    callback(message);
                }
            });

            this.pubSubCallbacks.set(channel, callback);
            console.log(`Successfully subscribed to Redis channel: ${channel}`);
        } catch (error) {
            console.error(`Error subscribing to Redis channel ${channel}:`, error);
        }
    }

    // Thêm method để unsubscribe Redis channel
    async unsubscribeFromChannel(channel) {
        try {
            if (this.subscriber) {
                await this.subscriber.unsubscribe(channel);
                this.pubSubCallbacks.delete(channel);
                console.log(`Unsubscribed from Redis channel: ${channel}`);
            }
        } catch (error) {
            console.error(`Error unsubscribing from Redis channel ${channel}:`, error);
        }
    }

    // Thêm method để publish message
    async publishMessage(channel, message) {
        try {
            if (!this.client) {
                await this.initialize();
            }

            const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
            await this.client.publish(channel, messageStr);
            console.log(`Published message to Redis channel ${channel}:`, message);
        } catch (error) {
            console.error(`Error publishing to Redis channel ${channel}:`, error);
        }
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