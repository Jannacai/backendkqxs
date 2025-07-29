const redisManager = require('./redisMT');
const { broadcastLotteryUpdate } = require('../websocket');

class RedisListener {
    constructor() {
        this.isListening = false;
        this.channels = new Set();
    }

    async startListening() {
        if (this.isListening) {
            console.log('Redis listener already started');
            return;
        }

        try {
            console.log('=== STARTING REDIS LISTENER ===');
            console.log('Starting Redis listener for lottery updates...');

            // Subscribe to lottery update channels using redisManager
            await this.subscribeToLotteryUpdates();

            this.isListening = true;
            console.log('=== REDIS LISTENER STARTED SUCCESSFULLY ===');
        } catch (error) {
            console.error('Error starting Redis listener:', error);
        }
    }

    async subscribeToLotteryUpdates() {
        try {
            console.log('=== SUBSCRIBING TO REDIS CHANNELS ===');

            // Test Redis connection first
            const redis = await redisManager.getClient();
            console.log('Redis client status:', redis.isReady ? 'READY' : 'NOT READY');

            // Subscribe to general lottery updates
            await redisManager.subscribeToChannel('lottery:updates', async (data) => {
                console.log('=== REDIS LOTTERY UPDATE RECEIVED ===');
                console.log('Channel: lottery:updates');
                console.log('Data:', data);

                if (data && data.station && data.date && data.tinh && data.prizeType && data.prizeData) {
                    await this.handleLotteryUpdate(data);
                }
            });

            // Subscribe to specific station updates
            await redisManager.subscribeToChannel('lottery:xsmt:updates', async (data) => {
                console.log('=== REDIS XSMT UPDATE RECEIVED ===');
                console.log('Channel: lottery:xsmt:updates');
                console.log('Data:', data);

                if (data && data.date && data.tinh && data.prizeType && data.prizeData) {
                    await this.handleLotteryUpdate({
                        ...data,
                        station: 'xsmt'
                    });
                }
            });

            // Subscribe to scraper updates
            await redisManager.subscribeToChannel('xsmt:29-07-2025', async (data) => {
                console.log('=== REDIS SCRAPER UPDATE RECEIVED ===');
                console.log('Channel: xsmt:29-07-2025');
                console.log('Data:', data);

                if (data && data.drawDate && data.tinh && data.prizeType && data.prizeData) {
                    await this.handleLotteryUpdate({
                        station: 'xsmt',
                        date: data.drawDate,
                        tinh: data.tinh,
                        prizeType: data.prizeType,
                        prizeData: data.prizeData
                    });
                }
            });

            console.log('=== SUBSCRIBED TO LOTTERY UPDATE CHANNELS ===');
            console.log('Channels: lottery:updates, lottery:xsmt:updates, xsmt:29-07-2025');

            // Test publish to verify subscription works
            setTimeout(async () => {
                try {
                    console.log('=== TESTING REDIS PUBLISH ===');
                    await redisManager.publishMessage('lottery:xsmt:updates', {
                        station: 'xsmt',
                        date: '29-07-2025',
                        tinh: 'hue',
                        prizeType: 'testPrize',
                        prizeData: 'TEST123',
                        timestamp: Date.now()
                    });
                    console.log('=== TEST PUBLISH COMPLETED ===');
                } catch (error) {
                    console.error('Test publish failed:', error);
                }
            }, 2000);

        } catch (error) {
            console.error('Error subscribing to lottery updates:', error);
        }
    }

    async handleLotteryUpdate(data) {
        try {
            const { station, date, tinh, prizeType, prizeData } = data;

            console.log(`Processing lottery update: ${station}:${date}:${tinh} - ${prizeType} = ${prizeData}`);

            // Lấy dữ liệu hiện tại từ Redis
            const redis = await redisManager.getClient();
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
                tentinh: this.getProvinceName(tinh),
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
            const broadcastData = [fullData];
            await broadcastLotteryUpdate(station, date, broadcastData);

            console.log(`Successfully processed and broadcasted update: ${prizeType} = ${prizeData}`);

        } catch (error) {
            console.error('Error handling lottery update:', error);
        }
    }

    getProvinceName(tinh) {
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

    async stopListening() {
        try {
            for (const channel of this.channels) {
                await redisManager.unsubscribeFromChannel(channel);
            }
            this.channels.clear();
            this.isListening = false;
            console.log('Redis listener stopped');
        } catch (error) {
            console.error('Error stopping Redis listener:', error);
        }
    }
}

// Singleton instance
const redisListener = new RedisListener();

module.exports = redisListener; 