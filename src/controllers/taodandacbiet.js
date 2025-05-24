const mongoose = require('mongoose');
const XSMB = require('../models/XS_MB.models');
const { formatDate, getFilterRange, getLastTwoDigits } = require('./xsmbController');

// Hàm trích xuất Đầu và Đuôi từ 2 số cuối
const extractDauDuoi = (number) => {
    if (!number || typeof number !== 'string' || !/^\d+$/.test(number)) return null;
    const str = number.toString();
    const lastTwo = str.length >= 2 ? str.slice(-2) : str.padStart(2, '0');
    const dau = parseInt(lastTwo[0]);
    const duoi = parseInt(lastTwo[1]);
    return { dau, duoi };
};

// Hàm kiểm tra điều kiện tạo dàn
const checkCondition = (number, dau, duoi, tong, kep) => {
    const { dau: numDau, duoi: numDuoi } = extractDauDuoi(number.toString());
    const sum = numDau + numDuoi;
    const isKep = numDau === numDuoi;

    const dauMatch = dau === 'Tất cả' || (dau === 'Đầu chẵn' && numDau % 2 === 0) || (dau === 'Đầu lẻ' && numDau % 2 !== 0);
    const duoiMatch = duoi === 'Tất cả' || (duoi === 'Đuôi chẵn' && numDuoi % 2 === 0) || (duoi === 'Đuôi lẻ' && numDuoi % 2 !== 0);
    const tongMatch = tong === 'Tất cả' || (tong === 'Tổng chẵn' && sum % 2 === 0) || (tong === 'Tổng lẻ' && sum % 2 !== 0);
    const kepMatch = kep === 'Tất cả' || (kep === 'Kép' && isKep) || (kep === 'Không kép' && !isKep);

    return dauMatch && duoiMatch && tongMatch && kepMatch;
};

const createDanDacBiet = async (days, tinh, options) => {
    try {
        const validDaysOptions = [30, 60, 90, 120, 180, 365];
        const daysNum = Number(days);
        if (!validDaysOptions.includes(daysNum)) {
            throw new Error('Tham số days không hợp lệ. Các giá trị hợp lệ: 30, 60, 90, 120, 180, 365.');
        }

        let Model = XSMB;
        let station = 'xsmb';
        if (tinh && ['hue', 'phu-yen', 'dak-lak', 'quang-nam', 'khanh-hoa', 'da-nang', 'binh-dinh', 'quang-tri', 'ninh-thuan', 'gia-lai', 'quang-ngai', 'dak-nong', 'kon-tum'].includes(tinh)) {
            Model = require('../models/XS_MT.models');
            station = 'xsmt';
        } else if (tinh && ['vung-tau', 'can-tho', 'dong-thap', 'tphcm', 'ca-mau', 'ben-tre', 'bac-lieu', 'soc-trang', 'dong-nai', 'an-giang', 'tay-ninh', 'binh-thuan', 'vinh-long', 'tra-vinh', 'long-an', 'binh-phuoc', 'hau-giang', 'kien-giang', 'tien-giang', 'da-lat'].includes(tinh)) {
            Model = require('../models/XS_MN.models');
            station = 'xsmn';
        }

        const { maxDays, description } = getFilterRange(daysNum, 'specialPrize');
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - maxDays);

        let query = {
            drawDate: { $gte: startDate, $lte: endDate },
        };
        if (station !== 'xsmb' && tinh) {
            query.tinh = tinh;
        }

        const results = await Model.find(query)
            .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes eightPrizes')
            .sort({ drawDate: -1 })
            .lean();

        if (results.length === 0) {
            throw new Error(`Không tìm thấy dữ liệu trong cơ sở dữ liệu cho ${station}${tinh ? ` (tỉnh: ${tinh})` : ''}.`);
        }

        const allNumbers = [];
        results.forEach(result => {
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
            allPrizes.forEach(prize => {
                const lastTwo = getLastTwoDigits(prize);
                if (lastTwo !== null && !allNumbers.includes(lastTwo)) {
                    allNumbers.push(lastTwo);
                }
            });
        });

        const danDacBiet = options.soDanhSach.filter(num => {
            return checkCondition(num, options.dau, options.duoi, options.tong, options.kep) ||
                allNumbers.includes(num);
        }).map(num => num.toString().padStart(2, '0'));

        const response = {
            statistics: danDacBiet,
            metadata: {
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                totalDraws: results.length,
                days: daysNum,
                filterType: description,
                totalNumbers: danDacBiet.length,
                tinh: tinh,
                message: danDacBiet.length === 0 ? 'Không tạo được dàn đặc biệt với điều kiện đã chọn.' : undefined,
            },
        };

        return response;
    } catch (error) {
        throw error;
    }
};

module.exports = { createDanDacBiet };