const express = require('express');
const router = express.Router();
const TelegramBot = require('node-telegram-bot-api');
const NodeCache = require('node-cache'); // Thêm thư viện caching

const token = process.env.TELEGRAM_BOT_TOKEN || '7789171652:AAEmz2GIO5WECWE2K1o-d6bve3vdvFctLCg';
const bot = new TelegramBot(token);
const BASE_API_URL = 'https://backendkqxs.onrender.com/api/kqxs';

// Khởi tạo cache với thời gian sống (TTL) là 1 giờ
const cache = new NodeCache({ stdTTL: 3600 });

router.post('/', async (req, res) => {
    const update = req.body;
    try {
        if (!update.message || !update.message.text) {
            return res.status(200).send('OK');
        }

        const chatId = update.message.chat.id;
        const text = update.message.text.trim();
        const command = text.split(' ')[0].toLowerCase();
        const args = text.split(' ').slice(1);

        const sendLongMessage = async (chatId, text) => {
            const maxLength = 4096;
            const messages = [];
            for (let i = 0; i < text.length; i += maxLength) {
                messages.push(text.slice(i, i + maxLength));
            }
            await Promise.all(messages.map(msg => bot.sendMessage(chatId, msg)));
        };

        const callApi = async (endpoint, params = {}) => {
            const query = new URLSearchParams(params).toString();
            const url = `${BASE_API_URL}${endpoint}${query ? '?' + query : ''}`;
            const cacheKey = url;

            // Kiểm tra cache trước khi gọi API
            const cachedData = cache.get(cacheKey);
            if (cachedData) {
                return cachedData;
            }

            const response = await fetch(url, {
                headers: { 'x-user-id': 'bot' },
                method: 'GET',
                timeout: 5000, // Thêm timeout để tránh chờ quá lâu
            });

            if (response.status !== 200) {
                throw new Error(`Lỗi khi gọi API ${endpoint}: ${response.statusText}`);
            }

            const data = await response.json();
            cache.set(cacheKey, data); // Lưu vào cache
            return data;
        };

        switch (command) {
            case '/start':
                const imageUrl = 'https://i.ibb.co/H29L7WL/460.jpg';
                const welcomeMessage = `
💎[TIN888 UY TÍN TẠO NIỀM TIN](https://tin888vn.online/)💎
         Nhà Cái Uy Tín Số 1 Châu Á

✅ ƯU ĐIỂM VƯỢT BẬT CỦA CHÚNG TÔI:

⭐️ Đề Miền Bắc 1: 99.5
⭐️ Đề Live 18h25 1:95
⭐️ Sản Phẩm Đa Dạng, Hấp Dẫn.
⭐️ Uy Tín - Rõ Ràng - Minh Bạch.
⭐️ Nạp Rút Nhanh Chóng, An Toàn Bảo Mật.
⭐️ Đội Ngũ CSKH Hỗ Chu Đáo, Chuyên Nghiệp 24/7
⭐️ Cam Kết Mang Đến Trải Nghiệm Tuyệt Vời Nhất Cho Khách Hàng.

 ✅ HÀNG NGÀN ƯU ĐÃI HẤP DẪN:

🎁 Thưởng chào mừng thành viên mới đến 150%.
🎁 Gửi tiền lần đầu nhận thưởng lên đến 28.888,000 VNĐ.
🎁 Nạp tiền tích lũy nhận thưởng lên đến 18,888,888 VNĐ.
🎁 Siêu hoàn trả mỗi ngày đến 2%.
🎁 Tiền thưởng hàng ngày lên đến: 88,888,888 VNĐ.
🎁 Hoa hồng đại lý đến 65%.
🔥 Nhiều ưu đãi cực khủng khác [tại đây](https://tin888.com/promotions)

🌍 [Hơn 90,000 người chơi tin tưởng tham gia TIN888.](https://tin888vn.online/)
🔥 [TIN888](https://tin888vn.online/) Bùng Cháy Khát Khao Trong Bạn!
🎰 CHƠI NGAY - THẮNG LỚN! ⤵️⤵️
`;
                const inlineKeyboard = {
                    inline_keyboard: [
                        [{ text: 'CHƠI NGAY', url: 'https://tin888vn.online/' }],
                        [{ text: 'LIÊN HỆ CSKH 24/7', url: 'https://t.me/CSKHTIN888/' }],
                        [{ text: 'CỘNG ĐỒNG TIN888', url: 'https://t.me/trangchutin888/' }],
                    ]
                };

                try {
                    // Bỏ kiểm tra URL ảnh để giảm độ trễ
                    await bot.sendPhoto(chatId, imageUrl, {
                        caption: welcomeMessage.length > 1024 ? welcomeMessage.slice(0, 1024) : welcomeMessage,
                        parse_mode: 'Markdown',
                        reply_markup: inlineKeyboard
                    });

                    if (welcomeMessage.length > 1024) {
                        await sendLongMessage(chatId, welcomeMessage.slice(1024));
                    }
                } catch (photoError) {
                    await bot.sendMessage(chatId, 'Không thể gửi ảnh, nhưng bạn vẫn có thể khám phá TIN888!', {
                        parse_mode: 'Markdown',
                        reply_markup: inlineKeyboard
                    });
                    await sendLongMessage(chatId, welcomeMessage);
                }
                break;

            case '/xsmb':
                const xsmbData = await callApi('/xsmb');
                if (!xsmbData || xsmbData.length === 0) {
                    await bot.sendMessage(chatId, 'Không tìm thấy kết quả XSMB.');
                    break;
                }
                const latestResult = xsmbData[0];
                const resultText = `Kết quả XSMB ngày ${new Date(latestResult.drawDate).toLocaleDateString('vi-VN')}:\n` +
                    `Đặc biệt: ${latestResult.specialPrize[0] || 'Chưa có'}\n` +
                    `Giải nhất: ${latestResult.firstPrize[0] || 'Chưa có'}`;
                await bot.sendMessage(chatId, resultText);
                break;

            case '/range':
                if (args.length < 2) {
                    await bot.sendMessage(chatId, 'Vui lòng cung cấp startDate và endDate. Ví dụ: /range 01-05-2025 05-05-2025');
                    break;
                }
                const [startDate, endDate] = args;
                const rangeData = await callApi('/range', { startDate, endDate });
                if (rangeData.error) {
                    await bot.sendMessage(chatId, rangeData.error);
                    break;
                }
                const rangeText = rangeData.map(result =>
                    `Ngày ${new Date(result.drawDate).toLocaleDateString('vi-VN')}: Đặc biệt: ${result.specialPrize[0] || 'Chưa có'}`
                ).join('\n');
                await sendLongMessage(chatId, rangeText || 'Không tìm thấy kết quả.');
                break;

            case '/statistics':
                if (args.length < 1) {
                    await bot.sendMessage(chatId, 'Vui lòng chọn loại thống kê: gan, special, dau-duoi, tan-suat-loto. Ví dụ: /statistics gan 7');
                    break;
                }
                const [statType, days = 7] = args;
                const validStatTypes = ['gan', 'special', 'dau-duoi', 'tan-suat-loto'];
                if (!validStatTypes.includes(statType)) {
                    await bot.sendMessage(chatId, 'Loại thống kê không hợp lệ. Chọn: gan, special, dau-duoi, tan-suat-loto.');
                    break;
                }
                const statData = await callApi(`/statistics/${statType}`, { days });
                if (statData.error) {
                    await bot.sendMessage(chatId, statData.error);
                    break;
                }
                const statText = JSON.stringify(statData, null, 2).slice(0, 4000);
                await sendLongMessage(chatId, `Thống kê ${statType} (${days} ngày):\n${statText}`);
                break;

            case '/soicau':
                if (args.length < 3) {
                    await bot.sendMessage(chatId, 'Vui lòng cung cấp startDate, endDate và days. Ví dụ: /soicau 01-05-2025 05-05-2025 7');
                    break;
                }
                const [scStartDate, scEndDate, scDays] = args;
                const soicauData = await callApi('/soicau/bach-thu/range', { startDate: scStartDate, endDate: scEndDate, days: scDays });
                if (soicauData.error) {
                    await bot.sendMessage(chatId, soicauData.error);
                    break;
                }
                const soicauText = soicauData.map(result =>
                    `Ngày ${result.date}: ${JSON.stringify(result.predictions)}`
                ).join('\n');
                await sendLongMessage(chatId, soicauText || 'Không tìm thấy kết quả soi cầu.');
                break;

            default:
                await bot.sendMessage(chatId, 'Lệnh không hợp lệ. Gõ /start để xem danh sách lệnh.');
        }

        return res.status(200).send('OK');
    } catch (error) {
        console.error('Lỗi xử lý webhook Telegram:', error.message);
        if (update?.message?.chat) {
            await bot.sendMessage(update.message.chat.id, 'Có lỗi xảy ra, vui lòng thử lại sau.');
        }
        return res.status(500).send('Internal Server Error');
    }
});

module.exports = router;