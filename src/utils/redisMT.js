const { createClient } = require('redis');
const { createPool } = require('generic-pool');

class RedisManager {
    constructor() {
        this.HEARTBEAT_INTERVAL = 30000; // 30s
        this.pool = createPool({
            create: async () => {
                try {
                    const client = createClient({
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
                    client.on('error', (err) => console.error('Redis Client Error:', err));
                    client.on('ready', () => {
                        console.log('Redis client connected successfully');
                        this.startHeartbeat(client);
                    });
                    await client.connect();
                    return client;
                } catch (err) {
                    console.error('Failed to create Redis client:', err);
                    throw err;
                }
            },
            destroy: async (client) => {
                if (client.isOpen) {
                    await client.quit();
                }
            },
        }, {
            min: 5,
            max: 100,
            autostart: true,
        });
    }

    startHeartbeat(client) {
        const heartbeatInterval = setInterval(async () => {
            try {
                if (client.isOpen) {
                    await client.ping();
                }
            } catch (err) {
                console.error('Redis heartbeat failed:', err);
                if (client.isOpen) {
                    await client.quit();
                }
            }
        }, this.HEARTBEAT_INTERVAL);

        client.on('end', () => {
            clearInterval(heartbeatInterval);
        });
    }

    async getClient() {
        const client = await this.pool.acquire();
        console.log(`Acquired Redis client, pool status: ${this.pool.available}/${this.pool.size}`);
        return client;
    }

    async getSubscriber() {
        const client = await this.pool.acquire();
        console.log(`Acquired Redis subscriber, pool status: ${this.pool.available}/${this.pool.size}`);
        return client;
    }

    async release(client) {
        if (client?.isOpen) {
            await this.pool.release(client);
            console.log(`Released Redis client, pool status: ${this.pool.available}/${this.pool.size}`);
        }
    }

    async close(client) {
        if (client?.isOpen) {
            await this.pool.destroy(client);
            console.log(`Closed Redis client, pool status: ${this.pool.available}/${this.pool.size}`);
        }
    }
}

const redisManager = new RedisManager();

process.on('SIGINT', async () => {
    await redisManager.pool.drain();
    await redisManager.pool.clear();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await redisManager.pool.drain();
    await redisManager.pool.clear();
    process.exit(0);
});

module.exports = redisManager;