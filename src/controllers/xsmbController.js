const mongoose = require('mongoose');
const XSMB = require('../models/XS_MB.models');
const XSMT = require('../models/XS_MT.models');
const XSMN = require('../models/XS_MN.models');
const { getRedisClient } = require('../utils/redis');

// Hàm trích xuất 2 số cuối
const getLastTwoDigits = (number) => {
    if (!number || typeof number !== 'string' || !/^\d+$/.test(number)) return null;
    const str = number.toString();
    return str.length >= 2 ? parseInt(str.slice(-2)) : parseInt(str);
};

// Hàm định dạng ngày
const formatDate = (date) => {
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
};

// Hàm tính số ngày giữa 2 ngày
const getDaysBetween = (start, end) => {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round(Math.abs((end - start) / oneDay));
};

// Hàm xác định khoảng lọc dựa trên days
const getFilterRange = (days, type = 'specialPrize') => {
    const specialPrizeRanges = {
        10: { maxDays: 10, description: '10 ngày' },
        20: { maxDays: 20, description: '20 ngày' },
        30: { maxDays: 30, description: '30 ngày' },
        60: { maxDays: 60, description: '2 tháng' },
        90: { maxDays: 90, description: '3 tháng' },
        180: { maxDays: 180, description: '6 tháng' },
        270: { maxDays: 270, description: '9 tháng' },
        365: { maxDays: 365, description: '1 năm' },
    };

    const loGanRanges = {
        6: { minDays: 3, maxDays: 6, description: 'Dưới 7 ngày' },
        7: { minDays: 7, maxDays: 14, description: 'Từ 7 đến 14 ngày' },
        14: { minDays: 14, maxDays: 29, description: 'Từ 14 đến 28 ngày' },
        30: { minDays: 3, maxDays: 30, description: 'Trong 30 ngày' },
        60: { minDays: 3, maxDays: 60, description: 'Trong 60 ngày' },
    };

    if (type === 'loGan') {
        return loGanRanges[days] || { minDays: 3, maxDays: days, description: `${days} ngày` };
    } else {
        return specialPrizeRanges[days] || { maxDays: days, description: `${days} ngày` };
    }
};

// Hàm tính toán giải đặc biệt theo tuần
const calculateSpecialPrizeStatsByWeek = async (month, year, station, tinh = null) => {
    try {
        const monthNum = Number(month);
        const yearNum = Number(year);

        if (!month || !year || isNaN(monthNum) || isNaN(yearNum)) {
            throw new Error('Tham số month và year là bắt buộc và phải là số.');
        }
        if (monthNum < 1 || monthNum > 12) {
            throw new Error('Tham số month không hợp lệ. Giá trị hợp lệ: 1-12.');
        }
        if (yearNum < 2000 || yearNum > new Date().getFullYear()) {
            throw new Error(`Tham số year không hợp lệ. Giá trị hợp lệ: 2000 - ${new Date().getFullYear()}.`);
        }

        let Model;
        if (station === 'xsmb') {
            Model = XSMB;
        } else if (station === 'xsmt') {
            Model = XSMT;
        } else if (station === 'xsmn') {
            Model = XSMN;
        } else {
            throw new Error('Tham số station không hợp lệ. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const startDate = new Date(yearNum, monthNum - 1, 1);
        const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);

        console.log(`Tham số: month=${monthNum}, year=${yearNum}, station=${station}, tinh=${tinh}`);
        console.log(`Phạm vi ngày: ${formatDate(startDate)} đến ${formatDate(endDate)}`);

        let query = {
            drawDate: { $gte: startDate, $lte: endDate },
        };

        // Xử lý tinh=all cho XSMT/XSMN
        let validTinhValues = [];
        if (station === 'xsmt') {
            validTinhValues = [
                'hue', 'phu-yen', 'dak-lak', 'quang-nam', 'khanh-hoa', 'da-nang', 'binh-dinh',
                'quang-tri', 'ninh-thuan', 'gia-lai', 'quang-ngai', 'dak-nong', 'kon-tum'
            ];
        } else if (station === 'xsmn') {
            validTinhValues = [
                'vung-tau', 'can-tho', 'dong-thap', 'tphcm', 'ca-mau', 'ben-tre', 'bac-lieu',
                'soc-trang', 'dong-nai', 'an-giang', 'tay-ninh', 'binh-thuan', 'vinh-long', 'binh-duong',
                'tra-vinh', 'long-an', 'binh-phuoc', 'hau-giang', 'kien-giang', 'tien-giang',
                'da-lat', 'binh-duong'
            ];
        }

        if (station === 'xsmt' || station === 'xsmn') {
            if (!tinh || tinh.trim() === '') {
                throw new Error(`Tham số tinh là bắt buộc cho ${station === 'xsmt' ? 'Miền Trung' : 'Miền Nam'}.`);
            }
            if (tinh !== 'all' && !validTinhValues.includes(tinh)) {
                throw new Error(`Tham số tinh không hợp lệ cho ${station}. Giá trị hợp lệ: ${validTinhValues.join(', ')} hoặc 'all'.`);
            }
            if (tinh !== 'all') {
                query.tinh = tinh;
            }
        }

        console.log(`Query MongoDB:`, JSON.stringify(query));

        const results = await Model.find(query)
            .select('drawDate specialPrize tinh dayOfWeek')
            .sort({ drawDate: -1 })
            .lean();

        console.log(`Số lượng bản ghi tìm thấy: ${results.length}`);
        if (results.length === 0) {
            console.warn(`Không tìm thấy dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''} trong tháng ${monthNum}/${yearNum}.`);
            return {
                statistics: [],
                metadata: {
                    startDate: formatDate(startDate),
                    endDate: formatDate(endDate),
                    totalDraws: 0,
                    month: monthNum,
                    year: yearNum,
                    totalNumbers: 0,
                    message: `Không tìm thấy dữ liệu trong cơ sở dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''} trong tháng ${monthNum}/${yearNum}.`
                }
            };
        }

        console.log('Ngày xổ số gần nhất:', formatDate(results[0].drawDate));

        const specialPrizes = [];
        for (const result of results) {
            const drawDate = new Date(result.drawDate);
            const specialPrize = result.specialPrize || [];

            if (specialPrize.length === 0) {
                console.log(`Không có giải đặc biệt cho ngày ${formatDate(drawDate)}`);
                continue;
            }

            const day = drawDate.getDate();
            const week = Math.ceil(day / 7);

            specialPrize.forEach(prize => {
                if (prize && typeof prize === 'string' && /^\d+$/.test(prize)) {
                    const entry = {
                        number: prize,
                        drawDate: formatDate(drawDate),
                        week: week,
                        dayOfWeek: result.dayOfWeek || 'Không xác định',
                    };
                    if (station === 'xsmt' || station === 'xsmn') {
                        entry.tinh = result.tinh;
                    }
                    specialPrizes.push(entry);
                }
            });
        }

        console.log('Danh sách giải đặc biệt theo tuần:', specialPrizes);

        const response = {
            statistics: specialPrizes,
            metadata: {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                totalDraws: results.length,
                month: monthNum,
                year: yearNum,
                totalNumbers: specialPrizes.length,
                message: specialPrizes.length === 0 ? `Không tìm thấy giải đặc biệt nào trong tháng ${monthNum}/${yearNum}.` : undefined,
            },
        };

        console.log('Response cuối cùng:', JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        console.error(`Lỗi trong calculateSpecialPrizeStatsByWeek:`, error.message);
        throw error;
    }
};

// Controller cho giải đặc biệt theo tuần
const getSpecialPrizeStatsByWeek = async (req, res) => {
    const { month, year, station, tinh } = req.query;
    try {
        if (!month || !year || isNaN(month) || isNaN(year)) {
            throw new Error('Tham số month và year là bắt buộc và phải là số.');
        }
        if (!station) {
            throw new Error('Tham số station là bắt buộc. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const cacheKey = `specialPrizeByWeek:${station}:${tinh || 'all'}:${month}:${year}`;
        const redisClient = await getRedisClient();
        console.log('Redis client status:', redisClient.isOpen);
        let cached;
        try {
            cached = await redisClient.get(cacheKey);
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis:', redisErr.message);
        }

        if (cached) {
            console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await calculateSpecialPrizeStatsByWeek(month, year, station, tinh);
        try {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(result));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu vào Redis:', redisErr.message);
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi trong getSpecialPrizeStatsByWeek:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu')) {
            res.status(404).json({ error: error.message });
        } else if (error.message.includes('Invalid') || error.message.includes('required')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
};

// Hàm tính toán lô gan
const calculateLoGan = async (days, station, tinh = null) => {
    try {
        const validDaysOptions = [6, 7, 14, 30, 60];
        const daysNum = Number(days);
        if (!validDaysOptions.includes(daysNum)) {
            throw new Error('Tham số days không hợp lệ. Các giá trị hợp lệ: 6, 7, 14, 30, 60.');
        }

        let Model;
        if (station === 'xsmb') {
            Model = XSMB;
        } else if (station === 'xsmt') {
            Model = XSMT;
        } else if (station === 'xsmn') {
            Model = XSMN;
        } else {
            throw new Error('Tham số station không hợp lệ. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const { minDays, maxDays, description } = getFilterRange(daysNum, 'loGan');

        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - maxDays);

        console.log(`Tham số: days=${daysNum}, filterRange=${description}, station=${station}, tinh=${tinh}`);
        console.log(`Phạm vi ngày: ${formatDate(startDate)} đến ${formatDate(endDate)}`);

        let query = {};
        if (station === 'xsmt' || station === 'xsmn') {
            if (!tinh || tinh.trim() === '') {
                throw new Error(`Tham số tinh là bắt buộc cho ${station === 'xsmt' ? 'Miền Trung' : 'Miền Nam'}.`);
            }
            query = { tinh: tinh };
        }

        const allResults = await Model.find(query)
            .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes eightPrizes')
            .sort({ drawDate: -1 })
            .limit(1000)
            .lean();
        if (allResults.length === 0) {
            throw new Error(`Không tìm thấy dữ liệu trong cơ sở dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''}.`);
        }
        console.log('Ngày xổ số gần nhất:', formatDate(allResults[0].drawDate));

        const stats = Array(100).fill().map((_, index) => ({
            number: index,
            lastAppeared: null,
            maxGap: 0,
            gaps: [],
            hasAppeared: false,
        }));

        let lastDrawDate = null;
        for (const result of allResults) {
            const drawDate = new Date(result.drawDate);
            const allPrizes = [
                ...(result.specialPrize || []),
                ...(result.firstPrize || []),
                ...(result.secondPrize || []),
                ...(result.threePrizes || []),
                ...(result.fourPrizes || []),
                ...(result.fivePrizes || []),
                ...(result.sixPrizes || []),
                ...(result.sevenPrizes || []),
                ...(result.eightPrizes || []),
            ];

            if (allPrizes.length === 0) {
                console.log(`Không có dữ liệu giải thưởng cho ngày ${formatDate(drawDate)}`);
            } else {
                console.log(`Dữ liệu giải thưởng ngày ${formatDate(drawDate)}:`, allPrizes);
            }

            const numbers = [...new Set(
                allPrizes
                    .map(prize => getLastTwoDigits(prize))
                    .filter(num => num !== null && num >= 0 && num <= 99)
            )];
            console.log(`Số tìm thấy ngày ${formatDate(drawDate)}:`, numbers);

            numbers.forEach(num => {
                stats[num].hasAppeared = true;
                if (stats[num].lastAppeared && lastDrawDate) {
                    const gap = getDaysBetween(drawDate, stats[num].lastAppeared);
                    stats[num].gaps.push(gap);
                }
                if (!stats[num].lastAppeared || drawDate > stats[num].lastAppeared) {
                    stats[num].lastAppeared = drawDate;
                }
            });
            lastDrawDate = drawDate;
        }

        stats.forEach(stat => {
            if (stat.hasAppeared) {
                const daysSinceLastAppeared = getDaysBetween(stat.lastAppeared, endDate);
                stat.gapDraws = daysSinceLastAppeared;
                stat.maxGap = stat.gaps.length > 0 ? Math.max(...stat.gaps) : daysSinceLastAppeared;
            }
        });

        const appearedStats = stats.filter(stat => stat.hasAppeared);
        console.log('Tổng số đã xuất hiện (trước lọc):', appearedStats.length);

        const filteredStats = appearedStats
            .filter(stat => {
                const daysSinceLastAppeared = getDaysBetween(stat.lastAppeared, endDate);
                const passesFilter = daysSinceLastAppeared >= minDays && daysSinceLastAppeared <= maxDays;
                if (passesFilter) {
                    console.log(`Số ${stat.number} qua bộ lọc: gapDraws=${daysSinceLastAppeared}, lastAppeared=${formatDate(stat.lastAppeared)}`);
                }
                return passesFilter;
            })
            .sort((a, b) => b.gapDraws - a.gapDraws);

        console.log('Số đã lọc:', filteredStats.map(stat => ({
            number: stat.number,
            gapDraws: stat.gapDraws,
            lastAppeared: formatDate(stat.lastAppeared),
        })));

        const response = {
            statistics: filteredStats.map(stat => ({
                number: stat.number.toString().padStart(2, '0'),
                lastAppeared: formatDate(stat.lastAppeared),
                gapDraws: stat.gapDraws,
                maxGap: stat.maxGap,
            })),
            metadata: {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                totalDraws: allResults.length,
                days: daysNum,
                filterType: description,
                totalNumbers: filteredStats.length,
                message: filteredStats.length === 0 ? 'Không tìm thấy số nào trong khoảng thời gian đã chọn.' : undefined,
            },
        };

        console.log('Response cuối cùng:', JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        throw error;
    }
};

// Hàm lấy danh sách giải đặc biệt
const calculateSpecialPrizeStats = async (days, station, tinh = null) => {
    try {
        const validDaysOptions = [10, 20, 30, 60, 90, 180, 270, 365];
        const daysNum = Number(days);
        if (!validDaysOptions.includes(daysNum)) {
            throw new Error('Tham số days không hợp lệ. Các giá trị hợp lệ: 10, 20, 30, 60, 90, 180, 270, 365.');
        }

        let Model;
        if (station === 'xsmb') {
            Model = XSMB;
        } else if (station === 'xsmt') {
            Model = XSMT;
        } else if (station === 'xsmn') {
            Model = XSMN;
        } else {
            throw new Error('Tham số station không hợp lệ. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const { maxDays, description } = getFilterRange(daysNum, 'specialPrize');

        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - maxDays);

        console.log(`Tham số: days=${daysNum}, filterRange=${description}, maxDays=${maxDays}, station=${station}, tinh=${tinh}`);
        console.log(`Phạm vi ngày: ${formatDate(startDate)} đến ${formatDate(endDate)}`);

        let query = {
            drawDate: { $gte: startDate, $lte: endDate },
        };
        if (station === 'xsmt' || station === 'xsmn') {
            if (!tinh || tinh.trim() === '') {
                throw new Error(`Tham số tinh là bắt buộc cho ${station === 'xsmt' ? 'Miền Trung' : 'Miền Nam'}.`);
            }
            query.tinh = tinh;
        }

        const results = await Model.find(query)
            .select('drawDate specialPrize tinh dayOfWeek')
            .sort({ drawDate: -1 })
            .lean();
        if (results.length === 0) {
            throw new Error(`Không tìm thấy dữ liệu trong cơ sở dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''}.`);
        }
        console.log('Ngày xổ số gần nhất:', formatDate(results[0].drawDate));
        console.log('Số lượng bản ghi tìm thấy:', results.length);

        const specialPrizes = [];
        for (const result of results) {
            const drawDate = new Date(result.drawDate);
            const specialPrize = result.specialPrize || [];

            if (specialPrize.length === 0) {
                console.log(`Không có giải đặc biệt cho ngày ${formatDate(drawDate)}`);
                continue;
            }

            specialPrize.forEach(prize => {
                if (prize && typeof prize === 'string' && /^\d+$/.test(prize)) {
                    const entry = {
                        number: prize,
                        drawDate: formatDate(drawDate),
                        dayOfWeek: result.dayOfWeek || 'Không xác định',
                    };
                    if (station === 'xsmt' || station === 'xsmn') {
                        entry.tinh = result.tinh;
                    }
                    specialPrizes.push(entry);
                }
            });
        }

        console.log('Danh sách giải đặc biệt:', specialPrizes);

        const response = {
            statistics: specialPrizes,
            metadata: {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                totalDraws: results.length,
                days: daysNum,
                filterType: description,
                totalNumbers: specialPrizes.length,
                message: specialPrizes.length === 0 ? 'Không tìm thấy giải đặc biệt nào trong khoảng thời gian đã chọn.' : undefined,
            },
        };

        console.log('Response cuối cùng:', JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        throw error;
    }
};

// Hàm trích xuất Đầu và Đuôi từ 2 số cuối
const extractDauDuoi = (number) => {
    if (!number || typeof number !== 'string' || !/^\d+$/.test(number)) return null;
    const str = number.toString();
    const lastTwo = str.length >= 2 ? str.slice(-2) : str.padStart(2, '0');
    const dau = parseInt(lastTwo[0]);
    const duoi = parseInt(lastTwo[1]);
    return { dau, duoi };
};

// Hàm tính toán Đầu/Đuôi
const calculateDauDuoiStats = async (days, tinh = null) => {
    try {
        const validDaysOptions = [30, 60, 90, 120, 180, 365];
        const daysNum = Number(days);
        if (!validDaysOptions.includes(daysNum)) {
            throw new Error('Tham số days không hợp lệ. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }

        let Model;
        let station;
        if (!tinh) {
            Model = XSMB;
            station = 'xsmb';
        } else if (['hue', 'phu-yen', 'dak-lak', 'quang-nam', 'khanh-hoa', 'da-nang', 'binh-dinh', 'quang-tri', 'ninh-thuan', 'gia-lai', 'quang-ngai', 'dak-nong', 'kon-tum'].includes(tinh)) {
            Model = XSMT;
            station = 'xsmt';
        } else if (['vung-tau', 'can-tho', 'dong-thap', 'tphcm', 'ca-mau', 'ben-tre', 'bac-lieu', 'soc-trang', 'dong-nai', 'an-giang', 'tay-ninh', 'binh-thuan', 'vinh-long', 'binh-duong', 'tra-vinh', 'long-an', 'binh-phuoc', 'hau-giang', 'kien-giang', 'tien-giang', 'da-lat'].includes(tinh)) {
            Model = XSMN;
            station = 'xsmn';
        } else {
            throw new Error('Tham số tinh không hợp lệ. Giá trị hợp lệ: null (Miền Bắc), hoặc các tỉnh của XSMT/XSMN.');
        }

        const { maxDays, description } = getFilterRange(daysNum, 'specialPrize');

        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - maxDays);

        console.log(`Tham số: days=${daysNum}, filterRange=${description}, station=${station}, tinh=${tinh}`);
        console.log(`Phạm vi ngày: ${formatDate(startDate)} đến ${formatDate(endDate)}`);

        let query = {
            drawDate: { $gte: startDate, $lte: endDate },
        };
        if (station === 'xsmt' || station === 'xsmn') {
            if (!tinh || tinh.trim() === '') {
                throw new Error(`Tham số tinh là bắt buộc cho ${station === 'xsmt' ? 'Miền Trung' : 'Miền Nam'}.`);
            }
            query.tinh = tinh;
        }

        const results = await Model.find(query)
            .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes eightPrizes tinh')
            .sort({ drawDate: -1 })
            .lean();
        if (results.length === 0) {
            throw new Error(`Không tìm thấy dữ liệu trong cơ sở dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''}.`);
        }
        console.log('Ngày xổ số gần nhất:', formatDate(results[0].drawDate));
        console.log('Số lượng bản ghi tìm thấy:', results.length);

        const dauStats = Array(10).fill(0);
        const duoiStats = Array(10).fill(0);
        let totalDauDuoi = 0;

        const specialDauStats = Array(10).fill(0);
        const specialDuoiStats = Array(10).fill(0);
        let totalSpecialDauDuoi = 0;

        for (const result of results) {
            const drawDate = new Date(result.drawDate);
            const allPrizes = [
                ...(result.specialPrize || []),
                ...(result.firstPrize || []),
                ...(result.secondPrize || []),
                ...(result.threePrizes || []),
                ...(result.fourPrizes || []),
                ...(result.fivePrizes || []),
                ...(result.sixPrizes || []),
                ...(result.sevenPrizes || []),
                ...(result.eightPrizes || []),
            ];

            if (allPrizes.length === 0) {
                console.log(`Không có dữ liệu giải thưởng cho ngày ${formatDate(drawDate)}`);
                continue;
            }

            allPrizes.forEach(prize => {
                const dauDuoi = extractDauDuoi(prize);
                if (dauDuoi) {
                    dauStats[dauDuoi.dau]++;
                    duoiStats[dauDuoi.duoi]++;
                    totalDauDuoi++;
                }
            });

            const specialPrize = result.specialPrize && result.specialPrize.length > 0 ? result.specialPrize[0] : null;
            if (specialPrize) {
                const specialDauDuoi = extractDauDuoi(specialPrize);
                if (specialDauDuoi) {
                    specialDauStats[specialDauDuoi.dau]++;
                    specialDuoiStats[specialDauDuoi.duoi]++;
                    totalSpecialDauDuoi++;
                }
            }
        }

        const dauStatsWithPercentage = dauStats.map((count, index) => ({
            dau: index,
            count,
            percentage: totalDauDuoi > 0 ? ((count / totalDauDuoi) * 100).toFixed(2) + '%' : '0.00%',
        }));

        const duoiStatsWithPercentage = duoiStats.map((count, index) => ({
            duoi: index,
            count,
            percentage: totalDauDuoi > 0 ? ((count / totalDauDuoi) * 100).toFixed(2) + '%' : '0.00%',
        }));

        const specialDauStatsWithPercentage = specialDauStats.map((count, index) => ({
            dau: index,
            count,
            percentage: totalSpecialDauDuoi > 0 ? ((count / totalSpecialDauDuoi) * 100).toFixed(2) + '%' : '0.00%',
        }));

        const specialDuoiStatsWithPercentage = specialDuoiStats.map((count, index) => ({
            duoi: index,
            count,
            percentage: totalSpecialDauDuoi > 0 ? ((count / totalSpecialDauDuoi) * 100).toFixed(2) + '%' : '0.00%',
        }));

        const specialDauDuoiStats = Array.from({ length: 10 }, (_, index) => ({
            number: index,
            dauCount: specialDauStatsWithPercentage[index].count,
            dauPercentage: specialDauStatsWithPercentage[index].percentage,
            duoiCount: specialDuoiStatsWithPercentage[index].count,
            duoiPercentage: specialDuoiStatsWithPercentage[index].percentage,
        }));

        const response = {
            dauStatistics: dauStatsWithPercentage,
            duoiStatistics: duoiStatsWithPercentage,
            specialDauDuoiStats: specialDauDuoiStats,
            metadata: {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                totalDraws: results.length,
                days: daysNum,
                filterType: description,
                totalDauDuoi,
                totalSpecialDauDuoi,
                tinh: tinh,
                message: totalDauDuoi === 0 ? 'Không tìm thấy dữ liệu Đầu Đuôi trong khoảng thời gian đã chọn.' : undefined,
            },
        };

        console.log('Response cuối cùng:', JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        throw error;
    }
};

// Hàm tính toán Đầu/Đuôi theo ngày
const calculateDauDuoiStatsByDate = async (days, tinh = null) => {
    try {
        const validDaysOptions = [30, 60, 90, 120, 180, 365];
        const daysNum = Number(days);
        if (!validDaysOptions.includes(daysNum)) {
            throw new Error('Tham số days không hợp lệ. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }

        let Model;
        let station;
        if (!tinh) {
            Model = XSMB;
            station = 'xsmb';
        } else if (['hue', 'phu-yen', 'dak-lak', 'quang-nam', 'khanh-hoa', 'da-nang', 'binh-dinh', 'quang-tri', 'ninh-thuan', 'gia-lai', 'quang-ngai', 'dak-nong', 'kon-tum'].includes(tinh)) {
            Model = XSMT;
            station = 'xsmt';
        } else if (['vung-tau', 'can-tho', 'dong-thap', 'tphcm', 'ca-mau', 'ben-tre', 'bac-lieu', 'soc-trang', 'dong-nai', 'an-giang', 'tay-ninh', 'binh-thuan', 'vinh-long', 'binh-duong', 'tra-vinh', 'long-an', 'binh-phuoc', 'hau-giang', 'kien-giang', 'tien-giang', 'da-lat'].includes(tinh)) {
            Model = XSMN;
            station = 'xsmn';
        } else {
            throw new Error('Tham số tinh không hợp lệ. Giá trị hợp lệ: null (Miền Bắc), hoặc các tỉnh của XSMT/XSMN.');
        }

        const { maxDays, description } = getFilterRange(daysNum, 'specialPrize');

        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - maxDays);

        console.log(`Tham số: days=${daysNum}, filterRange=${description}, station=${station}, tinh=${tinh}`);
        console.log(`Phạm vi ngày: ${formatDate(startDate)} đến ${formatDate(endDate)}`);

        let query = {
            drawDate: { $gte: startDate, $lte: endDate },
        };
        if (station === 'xsmt' || station === 'xsmn') {
            if (!tinh || tinh.trim() === '') {
                throw new Error(`Tham số tinh là bắt buộc cho ${station === 'xsmt' ? 'Miền Trung' : 'Miền Nam'}.`);
            }
            query.tinh = tinh;
        }

        const results = await Model.find(query)
            .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes eightPrizes tinh')
            .sort({ drawDate: -1 })
            .lean();
        if (results.length === 0) {
            throw new Error(`Không tìm thấy dữ liệu trong cơ sở dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''}.`);
        }
        console.log('Ngày xổ số gần nhất:', formatDate(results[0].drawDate));
        console.log('Số lượng bản ghi tìm thấy:', results.length);

        const dauStatsByDate = {};
        const duoiStatsByDate = {};

        for (const result of results) {
            const drawDate = new Date(result.drawDate);
            const dateKey = formatDate(drawDate);

            const allPrizes = [
                ...(result.specialPrize || []),
                ...(result.firstPrize || []),
                ...(result.secondPrize || []),
                ...(result.threePrizes || []),
                ...(result.fourPrizes || []),
                ...(result.fivePrizes || []),
                ...(result.sixPrizes || []),
                ...(result.sevenPrizes || []),
                ...(result.eightPrizes || []),
            ];

            if (allPrizes.length === 0) {
                console.log(`Không có dữ liệu giải thưởng cho ngày ${dateKey}`);
                continue;
            }

            if (!dauStatsByDate[dateKey]) {
                dauStatsByDate[dateKey] = Array(10).fill(0);
                duoiStatsByDate[dateKey] = Array(10).fill(0);
            }

            allPrizes.forEach(prize => {
                const dauDuoi = extractDauDuoi(prize);
                if (dauDuoi) {
                    dauStatsByDate[dateKey][dauDuoi.dau]++;
                    duoiStatsByDate[dateKey][dauDuoi.duoi]++;
                }
            });
        }

        const response = {
            dauStatsByDate,
            duoiStatsByDate,
            metadata: {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                totalDraws: results.length,
                days: daysNum,
                filterType: description,
                tinh: tinh,
                message: Object.keys(dauStatsByDate).length === 0 ? 'Không tìm thấy dữ liệu Đầu Đuôi trong khoảng thời gian đã chọn.' : undefined,
            },
        };

        console.log('Response cuối cùng:', JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        throw error;
    }
};

// Controller cho lô gan
const getLoGanStats = async (req, res) => {
    const { days, station, tinh } = req.query;
    try {
        if (!days || isNaN(days)) {
            throw new Error('Tham số days là bắt buộc và phải là số. Các giá trị hợp lệ: 6, 7, 14, 30, 60.');
        }
        if (!station) {
            throw new Error('Tham số station là bắt buộc. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const cacheKey = `loGan:${station}:${tinh || 'all'}:${days}`;
        const redisClient = await getRedisClient();
        console.log('Redis client status:', redisClient.isOpen);
        let cached;
        try {
            cached = await redisClient.get(cacheKey);
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis:', redisErr.message);
        }

        if (cached) {
            console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await calculateLoGan(days, station, tinh);
        try {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(result));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu vào Redis:', redisErr.message);
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi trong getLoGanStats:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu')) {
            res.status(404).json({ error: error.message });
        } else if (error.message.includes('Invalid') || error.message.includes('required')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
};

// Controller cho giải đặc biệt
const getSpecialPrizeStats = async (req, res) => {
    const { days, station, tinh } = req.query;
    try {
        if (!days || isNaN(days)) {
            throw new Error('Tham số days là bắt buộc và phải là số. Các giá trị hợp lệ: 10, 20, 30, 60, 90, 180, 270, 365.');
        }
        if (!station) {
            throw new Error('Tham số station là bắt buộc. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const cacheKey = `specialPrize:${station}:${tinh || 'all'}:${days}`;
        const redisClient = await getRedisClient();
        console.log('Redis client status:', redisClient.isOpen);
        let cached;
        try {
            cached = await redisClient.get(cacheKey);
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis:', redisErr.message);
        }

        if (cached) {
            console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await calculateSpecialPrizeStats(days, station, tinh);
        try {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(result));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu vào Redis:', redisErr.message);
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi trong getSpecialPrizeStats:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu')) {
            res.status(404).json({ error: error.message });
        } else if (error.message.includes('Invalid') || error.message.includes('required')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
};

// Controller cho thống kê Đầu Đuôi
const getDauDuoiStats = async (req, res) => {
    const { days, tinh } = req.query;
    try {
        if (!days || isNaN(days)) {
            throw new Error('Tham số days là bắt buộc và phải là số. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }

        const cacheKey = `dauDuoi:${days}:${tinh || 'all'}`;
        const redisClient = await getRedisClient();
        console.log('Redis client status:', redisClient.isOpen);
        let cached;
        try {
            cached = await redisClient.get(cacheKey);
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis:', redisErr.message);
        }

        if (cached) {
            console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await calculateDauDuoiStats(days, tinh);
        try {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(result));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu vào Redis:', redisErr.message);
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi trong getDauDuoiStats:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu')) {
            res.status(404).json({ error: error.message });
        } else if (error.message.includes('Invalid') || error.message.includes('required')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
};

// Controller cho thống kê Đầu Đuôi theo ngày
const getDauDuoiStatsByDate = async (req, res) => {
    const { days, tinh } = req.query;
    try {
        if (!days || isNaN(days)) {
            throw new Error('Tham số days là bắt buộc và phải là số. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }

        const cacheKey = `dauDuoiByDate:${days}:${tinh || 'all'}`;
        const redisClient = await getRedisClient();
        console.log('Redis client status:', redisClient.isOpen);
        let cached;
        try {
            cached = await redisClient.get(cacheKey);
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis:', redisErr.message);
        }

        if (cached) {
            console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await calculateDauDuoiStatsByDate(days, tinh);
        try {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(result));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu vào Redis:', redisErr.message);
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi trong getDauDuoiStatsByDate:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu')) {
            res.status(404).json({ error: error.message });
        } else if (error.message.includes('Invalid') || error.message.includes('required')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
};

// Hàm tính toán Tần Suất Loto
const calculateTanSuatLoto = async (days, station, tinh = null) => {
    try {
        const validDaysOptions = [30, 60, 90, 120, 180, 365];
        const daysNum = Number(days);
        if (!validDaysOptions.includes(daysNum)) {
            throw new Error('Tham số days không hợp lệ. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }

        let Model;
        if (station === 'xsmb') {
            Model = XSMB;
        } else if (station === 'xsmt') {
            Model = XSMT;
        } else if (station === 'xsmn') {
            Model = XSMN;
        } else {
            throw new Error('Tham số station không hợp lệ. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const { maxDays, description } = getFilterRange(daysNum, 'specialPrize');
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - maxDays);

        console.log(`Tham số: days=${daysNum}, filterRange=${description}, station=${station}, tinh=${tinh}`);
        console.log(`Phạm vi ngày: ${formatDate(startDate)} đến ${formatDate(endDate)}`);

        let query = {
            drawDate: { $gte: startDate, $lte: endDate },
        };

        // Áp dụng điều kiện tỉnh cho XSMT/XSMN
        if (station === 'xsmt' || station === 'xsmn') {
            if (!tinh || tinh.trim() === '') {
                throw new Error(`Tham số tinh là bắt buộc cho ${station === 'xsmt' ? 'Miền Trung' : 'Miền Nam'}.`);
            }
            const validTinhValues = station === 'xsmt' ? [
                'hue', 'phu-yen', 'dak-lak', 'quang-nam', 'khanh-hoa', 'da-nang', 'binh-dinh',
                'quang-tri', 'ninh-thuan', 'gia-lai', 'quang-ngai', 'dak-nong', 'kon-tum'
            ] : [
                'vung-tau', 'can-tho', 'dong-thap', 'tphcm', 'ca-mau', 'ben-tre', 'bac-lieu',
                'soc-trang', 'dong-nai', 'an-giang', 'tay-ninh', 'binh-thuan', 'vinh-long', 'binh-duong',
                'tra-vinh', 'long-an', 'binh-phuoc', 'hau-giang', 'kien-giang', 'tien-giang',
                'da-lat', 'binh-duong'
            ];
            if (!validTinhValues.includes(tinh)) {
                throw new Error(`Tham số tinh không hợp lệ cho ${station}. Giá trị hợp lệ: ${validTinhValues.join(', ')}.`);
            }
            query.tinh = tinh;
        }

        const results = await Model.find(query)
            .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes eightPrizes')
            .sort({ drawDate: -1 })
            .lean();

        if (results.length === 0) {
            throw new Error(`Không tìm thấy dữ liệu trong cơ sở dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''}.`);
        }

        console.log('Ngày xổ số gần nhất:', formatDate(results[0].drawDate));
        console.log('Số lượng bản ghi tìm thấy:', results.length);

        const lotoStats = Array(100).fill(0);
        let totalLoto = 0;

        for (const result of results) {
            const drawDate = new Date(result.drawDate);
            const allPrizes = [
                ...(result.specialPrize || []),
                ...(result.firstPrize || []),
                ...(result.secondPrize || []),
                ...(result.threePrizes || []),
                ...(result.fourPrizes || []),
                ...(result.fivePrizes || []),
                ...(result.sixPrizes || []),
                ...(result.sevenPrizes || []),
                ...(result.eightPrizes || []),
            ];

            if (allPrizes.length === 0) {
                console.log(`Không có dữ liệu giải thưởng cho ngày ${formatDate(drawDate)}`);
                continue;
            }

            allPrizes.forEach(prize => {
                const loto = getLastTwoDigits(prize);
                if (loto !== null && loto >= 0 && loto <= 99) {
                    lotoStats[loto]++;
                    totalLoto++;
                }
            });
        }

        const statsWithPercentage = lotoStats.map((count, index) => ({
            number: index.toString().padStart(2, '0'),
            count,
            percentage: totalLoto > 0 ? ((count / totalLoto) * 100).toFixed(2) + '%' : '0.00%',
        }));

        const response = {
            statistics: statsWithPercentage,
            metadata: {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                totalDraws: results.length,
                days: daysNum,
                filterType: description,
                totalNumbers: totalLoto,
                tinh: tinh,
                message: totalLoto === 0 ? 'Không tìm thấy dữ liệu Loto trong khoảng thời gian đã chọn.' : undefined,
            },
        };

        console.log('Response cuối cùng:', JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        throw error;
    }
};

// Controller cho thống kê Tần Suất Loto
const getTanSuatLotoStats = async (req, res) => {
    const { days, station, tinh } = req.query;
    try {
        if (!days || isNaN(days)) {
            throw new Error('Tham số days là bắt buộc và phải là số. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }
        if (!station) {
            throw new Error('Tham số station là bắt buộc. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const cacheKey = `tanSuatLoto:${station}:${tinh || 'all'}:${days}`;
        const redisClient = await getRedisClient();
        console.log('Redis client status:', redisClient.isOpen);
        let cached;
        try {
            cached = await redisClient.get(cacheKey);
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis:', redisErr.message);
        }

        if (cached) {
            console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await calculateTanSuatLoto(days, station, tinh);
        try {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(result));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu vào Redis:', redisErr.message);
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi trong getTanSuatLotoStats:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu')) {
            res.status(404).json({ error: error.message });
        } else if (error.message.includes('Invalid') || error.message.includes('required')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
};

// Danh sách các cặp lô cần thống kê
const predefinedLoCapPairs = [
    "00-55", "01-10", "02-20", "03-30", "04-40", "05-50", "06-60", "07-70", "08-80", "09-90",
    "11-66", "12-21", "13-31", "14-41", "15-51", "16-61", "17-71", "18-81", "19-91",
    "22-77", "23-32", "24-42", "25-52", "26-62", "27-72", "28-82", "29-92",
    "33-88", "34-43", "35-53", "36-63", "37-73", "38-83", "39-93",
    "44-99", "45-54", "46-64", "47-74", "48-84", "49-94",
    "55-00", "56-65", "57-75", "58-85", "59-95",
    "66-11", "67-76", "68-86", "69-96",
    "77-22", "78-87", "79-97",
    "88-33", "89-98",
];

// Hàm tính toán Tần Suất Lô Cặp
const calculateTanSuatLoCap = async (days, station, tinh = null) => {
    try {
        const validDaysOptions = [30, 60, 90, 120, 180, 365];
        const daysNum = Number(days);
        if (!validDaysOptions.includes(daysNum)) {
            throw new Error('Tham số days không hợp lệ. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }

        let Model;
        if (station === 'xsmb') {
            Model = XSMB;
        } else if (station === 'xsmt') {
            Model = XSMT;
        } else if (station === 'xsmn') {
            Model = XSMN;
        } else {
            throw new Error('Tham số station không hợp lệ. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const { maxDays, description } = getFilterRange(daysNum, 'specialPrize');
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - maxDays);

        let query = {
            drawDate: { $gte: startDate, $lte: endDate },
        };

        // Xử lý tinh cho XSMT/XSMN
        let validTinhValues = [];
        if (station === 'xsmt') {
            validTinhValues = [
                'hue', 'phu-yen', 'dak-lak', 'quang-nam', 'khanh-hoa', 'da-nang', 'binh-dinh',
                'quang-tri', 'ninh-thuan', 'gia-lai', 'quang-ngai', 'dak-nong', 'kon-tum'
            ];
        } else if (station === 'xsmn') {
            validTinhValues = [
                'vung-tau', 'can-tho', 'dong-thap', 'tphcm', 'ca-mau', 'ben-tre', 'bac-lieu',
                'soc-trang', 'dong-nai', 'an-giang', 'tay-ninh', 'binh-thuan', 'vinh-long',
                'tra-vinh', 'long-an', 'binh-phuoc', 'hau-giang', 'kien-giang', 'tien-giang',
                'da-lat', 'binh-duong'
            ];
        }

        if (station === 'xsmt' || station === 'xsmn') {
            if (!tinh || tinh.trim() === '') {
                throw new Error(`Tham số tinh là bắt buộc cho ${station === 'xsmt' ? 'Miền Trung' : 'Miền Nam'}.`);
            }
            if (tinh !== 'all' && !validTinhValues.includes(tinh)) {
                throw new Error(`Tham số tinh không hợp lệ cho ${station}. Giá trị hợp lệ: ${validTinhValues.join(', ')} hoặc 'all'.`);
            }
            if (tinh !== 'all') {
                query.tinh = tinh;
            }
        }

        console.log(`Query MongoDB:`, JSON.stringify(query));
        const results = await Model.find(query)
            .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes eightPrizes tinh')
            .sort({ drawDate: -1 })
            .lean();

        if (results.length === 0) {
            throw new Error(`Không tìm thấy dữ liệu trong cơ sở dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''}.`);
        }

        console.log(`Số lượng bản ghi tìm thấy: ${results.length}`);
        console.log(`Ngày xổ số gần nhất: ${formatDate(results[0].drawDate)}`);

        // Khởi tạo mảng thống kê cho từng số từ 00 đến 99
        const numberStats = Array(100).fill(0); // Đếm số lần xuất hiện của từng số (00-99)

        // Duyệt qua dữ liệu để đếm tần suất của từng số
        for (const result of results) {
            const drawDate = new Date(result.drawDate);
            const allPrizes = [
                ...(result.specialPrize || []),
                ...(result.firstPrize || []),
                ...(result.secondPrize || []),
                ...(result.threePrizes || []),
                ...(result.fourPrizes || []),
                ...(result.fivePrizes || []),
                ...(result.sixPrizes || []),
                ...(result.sevenPrizes || []),
                ...(result.eightPrizes || []),
            ];

            if (allPrizes.length === 0) {
                console.log(`Không có dữ liệu giải thưởng cho ngày ${formatDate(drawDate)}`);
                continue;
            }

            // Lấy tất cả các số loto (2 số cuối)
            const numbers = allPrizes
                .map(prize => getLastTwoDigits(prize))
                .filter(num => num !== null && num >= 0 && num <= 99);

            if (numbers.length === 0) {
                console.log(`Không tìm thấy số loto hợp lệ cho ngày ${formatDate(drawDate)}`);
                continue;
            }

            console.log(`Số loto ngày ${formatDate(drawDate)} (tỉnh: ${result.tinh || 'N/A'}):`, numbers);

            // Đếm tần suất của từng số
            numbers.forEach(num => {
                numberStats[num]++;
            });
        }

        // Khởi tạo mảng thống kê cho các cặp lô
        const loCapStats = predefinedLoCapPairs.reduce((acc, pair) => {
            const [xx, yy] = pair.split('-');
            const xxNum = parseInt(xx);
            const yyNum = parseInt(yy);
            const xxCount = numberStats[xxNum]; // Số lần xuất hiện của xx
            const yyCount = numberStats[yyNum]; // Số lần xuất hiện của yy
            const totalCount = xxCount + yyCount; // Tổng số lần xuất hiện của cặp

            acc[pair] = {
                pair,
                xxCount, // Số lần xuất hiện của số đầu tiên
                yyCount, // Số lần xuất hiện của số thứ hai
                count: totalCount, // Tổng số lần xuất hiện
                percentage: '0.00%' // Sẽ được tính sau
            };
            return acc;
        }, {});

        // Tính tổng số lần xuất hiện của tất cả các cặp (để tính phần trăm)
        let totalLoCap = 0;
        Object.values(loCapStats).forEach(stat => {
            totalLoCap += stat.count;
        });

        // Tính tỷ lệ phần trăm
        Object.values(loCapStats).forEach(stat => {
            const percentage = totalLoCap > 0 ? ((stat.count / totalLoCap) * 100).toFixed(2) : '0.00';
            stat.percentage = percentage + '%';
        });

        // Chuyển đổi thành mảng và sắp xếp theo tổng số lần xuất hiện giảm dần
        const sortedStats = Object.values(loCapStats).sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair));

        const response = {
            statistics: sortedStats,
            metadata: {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                totalDraws: results.length,
                days: daysNum,
                filterType: description,
                totalPairs: totalLoCap,
                tinh: tinh,
                message: totalLoCap === 0 ? 'Không tìm thấy dữ liệu Lô Cặp trong khoảng thời gian đã chọn.' : undefined,
            },
        };

        console.log('Response cuối cùng:', JSON.stringify(response, null, 2));
        return response;
    } catch (error) {
        console.error('Lỗi trong calculateTanSuatLoCap:', error.message);
        throw error;
    }
};

// Controller cho thống kê Tần Suất Lô Cặp
const getTanSuatLoCapStats = async (req, res) => {
    const { days, station, tinh } = req.query;
    try {
        if (!days || isNaN(days)) {
            throw new Error('Tham số days là bắt buộc và phải là số. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }
        if (!station) {
            throw new Error('Tham số station là bắt buộc. Các giá trị hợp lệ: xsmb, xsmt, xsmn.');
        }

        const cacheKey = `tanSuatLoCap:${station}:${tinh || 'all'}:${days}`;
        const redisClient = await getRedisClient();
        console.log('Redis client status:', redisClient.isOpen);
        let cached;
        try {
            cached = await redisClient.get(cacheKey);
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis:', redisErr.message);
        }

        if (cached) {
            console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
            return res.status(200).json(JSON.parse(cached));
        }

        const result = await calculateTanSuatLoCap(days, station, tinh);
        try {
            await redisClient.setEx(cacheKey, 7200, JSON.stringify(result));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu vào Redis:', redisErr.message);
        }

        res.status(200).json(result);
    } catch (error) {
        console.error('Lỗi trong getTanSuatLoCapStats:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu')) {
            res.status(404).json({ error: error.message });
        } else if (error.message.includes('Invalid') || error.message.includes('required')) {
            res.status(400).json({ error: error.message });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
};

module.exports = {
    getLoGanStats,
    getSpecialPrizeStats,
    getSpecialPrizeStatsByWeek,
    getDauDuoiStats,
    getDauDuoiStatsByDate,
    getTanSuatLotoStats,
    getTanSuatLoCapStats
};