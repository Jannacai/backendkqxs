// const { createClient } = require('redis');

// // Singleton clients và lock để tránh xung đột
// let redisClient; // Client cho đọc/ghi
// let subscriberClient; // Client cho Pub/Sub
// const redisLock = { initializing: false, subscriberInitializing: false };
// const pendingPromises = []; // Queue cho redisClient
// const subscriberPendingPromises = []; // Queue cho subscriberClient

// // Hàm tính thời gian backoff
// const calculateBackoff = (attempt) => Math.min(1000 * Math.pow(2, attempt - 1), 8000); // Max 8s

// // Khởi tạo client đọc/ghi
// const initializeRedis = async (retryCount = 3) => {
//     if (redisLock.initializing) {
//         return new Promise((resolve) => pendingPromises.push(resolve));
//     }

//     if (!redisClient) {
//         redisLock.initializing = true;
//         try {
//             redisClient = createClient({
//                 url: process.env.REDIS_URL || 'redis://localhost:6379',
//                 socket: {
//                     connectTimeout: 10000,
//                     keepAlive: 1000,
//                     reconnectStrategy: (retries) => {
//                         if (retries >= retryCount) {
//                             console.error('Redis reconnect failed after max retries');
//                             return false;
//                         }
//                         return calculateBackoff(retries + 1);
//                     },
//                 },
//             });

//             redisClient.on('error', (err) => console.error('Redis Client Error:', err));
//             redisClient.on('reconnecting', () => console.log('Redis client attempting to reconnect...'));
//             redisClient.on('ready', () => {
//                 console.log('Redis client connected or reconnected successfully');
//                 while (pendingPromises.length) {
//                     pendingPromises.shift()(redisClient);
//                 }
//             });

//             for (let attempt = 1; attempt <= retryCount; attempt++) {
//                 try {
//                     await redisClient.connect();
//                     console.log(`Redis client connected on attempt ${attempt}`);
//                     break;
//                 } catch (err) {
//                     console.error(`Attempt ${attempt} failed to connect to Redis:`, err.message);
//                     if (attempt === retryCount) {
//                         throw new Error(`Failed to connect to Redis after ${retryCount} attempts`);
//                     }
//                     await new Promise(resolve => setTimeout(resolve, calculateBackoff(attempt)));
//                 }
//             }
//         } catch (err) {
//             console.error('Failed to initialize Redis:', err);
//             throw err;
//         } finally {
//             redisLock.initializing = false;
//         }
//     }

//     return redisClient;
// };

// // Khởi tạo client Pub/Sub
// const initializeSubscriber = async (retryCount = 3) => {
//     if (redisLock.subscriberInitializing) {
//         return new Promise((resolve) => subscriberPendingPromises.push(resolve));
//     }

//     if (!subscriberClient) {
//         redisLock.subscriberInitializing = true;
//         try {
//             subscriberClient = createClient({
//                 url: process.env.REDIS_URL || 'redis://localhost:6379',
//                 socket: {
//                     connectTimeout: 10000,
//                     keepAlive: 1000,
//                     reconnectStrategy: (retries) => {
//                         if (retries >= retryCount) {
//                             console.error('Redis subscriber reconnect failed after max retries');
//                             return false;
//                         }
//                         return calculateBackoff(retries + 1);
//                     },
//                 },
//             });

//             subscriberClient.on('error', (err) => console.error('Redis Subscriber Error:', err));
//             subscriberClient.on('reconnecting', () => console.log('Redis subscriber attempting to reconnect...'));
//             subscriberClient.on('ready', () => {
//                 console.log('Redis subscriber connected or reconnected successfully');
//                 while (subscriberPendingPromises.length) {
//                     subscriberPendingPromises.shift()(subscriberClient);
//                 }
//             });

//             for (let attempt = 1; attempt <= retryCount; attempt++) {
//                 try {
//                     await subscriberClient.connect();
//                     console.log(`Redis subscriber connected on attempt ${attempt}`);
//                     break;
//                 } catch (err) {
//                     console.error(`Attempt ${attempt} failed to connect to Redis subscriber:`, err.message);
//                     if (attempt === retryCount) {
//                         throw new Error(`Failed to connect to Redis subscriber after ${retryCount} attempts`);
//                     }
//                     await new Promise(resolve => setTimeout(resolve, calculateBackoff(attempt)));
//                 }
//             }
//         } catch (err) {
//             console.error('Failed to initialize Redis subscriber:', err);
//             throw err;
//         } finally {
//             redisLock.subscriberInitializing = false;
//         }
//     }

//     return subscriberClient;
// };

// // Lấy client đọc/ghi
// const getRedisClient = async (commandTimeout = 5000) => {
//     if (!redisClient || !redisClient.isOpen) {
//         try {
//             await initializeRedis();
//         } catch (err) {
//             console.error('getRedisClient failed:', err.message);
//             throw new Error('Redis unavailable, please try again later');
//         }
//     }

//     if (!redisClient.isReady) {
//         await new Promise(resolve => setTimeout(resolve, 1000));
//         return getRedisClient(commandTimeout);
//     }

//     redisClient.options.commandTimeout = commandTimeout;
//     return redisClient;
// };

// // Lấy client Pub/Sub
// const getSubscriberClient = async (commandTimeout = 5000) => {
//     if (!subscriberClient || !subscriberClient.isOpen) {
//         try {
//             await initializeSubscriber();
//         } catch (err) {
//             console.error('getSubscriberClient failed:', err.message);
//             throw new Error('Redis subscriber unavailable, please try again later');
//         }
//     }

//     if (!subscriberClient.isReady) {
//         await new Promise(resolve => setTimeout(resolve, 1000));
//         return getSubscriberClient(commandTimeout);
//     }

//     subscriberClient.options.commandTimeout = commandTimeout;
//     return subscriberClient;
// };

// // Đóng cả hai client
// const closeRedis = async () => {
//     if (redisClient && redisClient.isOpen) {
//         try {
//             await redisClient.quit();
//             console.log('Redis client disconnected');
//         } catch (err) {
//             console.error('Failed to disconnect Redis client:', err);
//         } finally {
//             redisClient = null;
//         }
//     }

//     if (subscriberClient && subscriberClient.isOpen) {
//         try {
//             await subscriberClient.quit();
//             console.log('Redis subscriber disconnected');
//         } catch (err) {
//             console.error('Failed to disconnect Redis subscriber:', err);
//         } finally {
//             subscriberClient = null;
//         }
//     }
// };

// // Đóng Redis khi server dừng
// process.on('SIGINT', async () => {
//     await closeRedis();
//     process.exit(0);
// });

// process.on('SIGTERM', async () => {
//     await closeRedis();
//     process.exit(0);
// });

// module.exports = { getRedisClient, getSubscriberClient, initializeRedis, initializeSubscriber, closeRedis };