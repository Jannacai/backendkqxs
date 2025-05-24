const express = require('express');
const router = express.Router();
const TelegramBot = require('node-telegram-bot-api');
const NodeCache = require('node-cache');

const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const bot = new TelegramBot(token);
const BASE_API_URL = 'https://backendkqxs.onrender.com/api/kqxs'; // Đúng với cấu hình API

// Khởi tạo cache với thời gian sống (TTL) là 1 giờ
const cache = new NodeCache({ stdTTL: 3600 });

// Cache để ngăn lặp thông báo lỗi
const errorCache = new NodeCache({ stdTTL: 60 });

// Hàm hỗ trợ parse ngày
const parseDate = (dateStr) => {
    if (!dateStr || !/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        throw new Error('Định dạng ngày không hợp lệ. Vui lòng sử dụng DD-MM-YYYY.');
    }
    const [day, month, year] = dateStr.split('-').map(Number);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > new Date().getFullYear()) {
        throw new Error('Ngày, tháng hoặc năm không hợp lệ.');
    }
    return dateStr;
};

router.post('/', async (req, res) => {
    const update = req.body;
    // Phản hồi HTTP 200 ngay để tránh Telegram gửi lại cập nhật
    res.status(200).send('OK');

    try {
        if (!update.message || !update.message.text) {
            console.log('Webhook không có message hoặc text');
            return;
        }

        const chatId = update.message.chat.id;
        const messageId = update.message.message_id;
        const text = update.message.text.trim();
        const command = text.split(' ')[0].toLowerCase();
        const args = text.split(' ').slice(1);

        // Ngăn xử lý tin nhắn lặp
        const messageKey = `${chatId}:${messageId}`;
        if (cache.get(messageKey)) {
            console.log(`Bỏ qua tin nhắn lặp: ${messageKey}`);
            return;
        }
        cache.set(messageKey, true, 300);

        const send，长Message = async (chatId, text) => {
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
            console.log(`Gọi API: ${url}`);
            const cacheKey = url;

            const cachedData = cache.get(cacheKey);
            if (cachedData) {
                console.log(`Lấy dữ liệu từ cache: ${cacheKey}`);
                return cachedData;
            }

            const response = await fetch(url, {
                headers: { 'x-user-id': 'bot' },
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });

            if (response.status !== 200) {
                console.error(`Lỗi API ${url}: ${response.statusText}`);
                throw new Error(`Lỗi khi gọi API ${endpoint}: ${response.statusText}`);
            }

            const data = await response.json();
            if (!data || (Array.isArray(data) && data.length === 0)) {
                throw new Error(`Không tìm thấy dữ liệu từ API ${endpoint}`);
            }

            cache.set(cacheKey, data);
            console.log(`Lưu cache: ${cacheKey}`);
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
                    await bot.sendPhoto(chatId, imageUrl, {
                        caption: welcomeMessage.length > 1024 ? welcomeMessage.slice(0, 1024) : welcomeMessage,
                        parse_mode: 'Markdown',
                        reply_markup: inlineKeyboard
                    });

                    if (welcomeMessage.length > 1024) {
                        await sendLongMessage(chatId, welcomeMessage.slice(1024));
                    }
                } catch (photoError) {
                    console.error('Lỗi gửi ảnh:', photoError.message);
                    await bot.sendMessage(chatId, 'Không thể gửi ảnh, nhưng bạn vẫn có thể khám phá TIN888!', {
                        parse_mode: 'Markdown',
                        reply_markup: inlineKeyboard
                    });
                    await sendLongMessage(chatId, welcomeMessage);
                }
                break;

            case '/xsmb':
                try {
                    const xsmbData = await callApi('/xsmb');
                    const latestResult = xsmbData[0];
                    const drawDate = new Date(latestResult.drawDate).toLocaleDateString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });
                    const resultText = `Kết quả XSMB ngày ${drawDate}:\n` +
                        `Đặc biệt: ${latestResult.specialPrize?.[0] || 'Chưa có'}\n` +
                        `Giải nhất: ${latestResult.firstPrize?.[0] || 'Chưa có'}`;
                    await bot.sendMessage(chatId, resultText);
                } catch (error) {
                    console.error('Lỗi lệnh /xsmb:', error.message);
                    await bot.sendMessage(chatId, `Lỗi khi lấy kết quả XSMB: ${error.message}`);
                }
                break;

            case '/range':
                if (args.length < 2) {
                    await bot.sendMessage(chatId, 'Vui lòng cung cấp startDate và endDate. Ví dụ: /range 01-05-2025 05-05-2025');
                    break;
                }
                let [startDate, endDate] = args;
                try {
                    startDate = parseDate(startDate);
                    endDate = parseDate(endDate);
                    const rangeData = await callApi('/xsmb/range', { startDate, endDate });
                    const rangeText = rangeData.map(result => {
                        const drawDate = new Date(result.drawDate).toLocaleDateString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                        });
                        return `Ngày ${drawDate}: Đặc biệt: ${result.specialPrize?.[0] || 'Chưa có'}`;
                    }).join('\n');
                    await sendLongMessage(chatId, rangeText || 'Không tìm thấy kết quả.');
                } catch (error) {
                    console.error('Lỗi lệnh /range:', error.message);
                    await bot.sendMessage(chatId, `Lỗi khi lấy kết quả khoảng thời gian: ${error.message}`);
                }
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
                if (!/^\d+$/.test(days) || parseInt(days) < 1) {
                    await bot.sendMessage(chatId, 'Số ngày phải là số nguyên dương.');
                    break;
                }
                try {
                    const statData = await callApi(`/xsmb/statistics/${statType}`, { days });
                    const statText = JSON.stringify(statData, null, 2).slice(0, 4000);
                    await sendLongMessage(chatId, `Thống kê ${statType} (${days} ngày):\n${statText}`);
                } catch (error) {
                    console.error(`Lỗi lệnh /statistics ${statType}:`, error.message);
                    await bot.sendMessage(chatId, `Lỗi khi lấy thống kê ${statType}: ${error.message}`);
                }
                break;

            case '/soicau':
                if (args.length < 3) {
                    await bot.sendMessage(chatId, 'Vui lòng cung cấp startDate, endDate và days. Ví dụ: /soicau 01-05-2025 05-05-2025 7');
                    break;
                }
                let [scStartDate, scEndDate, scDays] = args;
                try {
                    scStartDate = parseDate(scStartDate);
                    scEndDate = parseDate(scEndDate);
                    const validDays = [3, 5, 7, 10, 14];
                    if (!validDays.includes(parseInt(scDays))) {
                        await bot.sendMessage(chatId, 'Số ngày không hợp lệ. Chỉ chấp nhận: 3, 5, 7, 10, 14.');
                        break;
                    }
                    const soicauData = await callApi('/xsmb/soicau/bach-thu/range', { startDate: scStartDate, endDate: scEndDate, days: scDays });
                    const soicauText = soicauData.map(result =>
                        `Ngày ${result.date}: ${JSON.stringify(result.predictions)}`
                    ).join('\n');
                    await sendLongMessage(chatId, soicauText || 'Không tìm thấy kết quả soi cầu.');
                } catch (error) {
                    console.error('Lỗi lệnh /soicau:', error.message);
                    await bot.sendMessage(chatId, `Lỗi khi lấy kết quả soi cầu: ${error.message}`);
                }
                break;

            default:
                await bot.sendMessage(chatId, 'Lệnh không hợp lệ. Các lệnh khả dụng:\n' +
                    '/start - Xem thông tin và ưu đãi\n' +
                    '/xsmb - Xem kết quả XSMB mới nhất\n' +
                    '/range <startDate> <endDate> - Xem kết quả trong khoảng thời gian\n' +
                    '/statistics <type> [days] - Xem thống kê (gan, special, dau-duoi, tan-suat-loto)\n' +
                    '/soicau <startDate> <endDate> <days> - Xem soi cầu bạch thủ');
        }
    } catch (error) {
        console.error('Lỗi xử lý webhook Telegram:', error.message);
        if (update?.message?.chat && !errorCache.get(`${update.message.chat.id}:error`)) {
            await bot.sendMessage(update.message.chat.id, 'Có lỗi xảy ra, vui lòng thử lại sau.');
            errorCache.set(`${update.message.chat.id}:error`, true, 60);
        }
    }
});

module.exports = router;