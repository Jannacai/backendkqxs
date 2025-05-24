const calculate3D = (req, res) => {
    const { input } = req.body;

    // Chuẩn hóa input cho 3D
    const parseAndNormalizeInput = (inputStr) => {
        // Chuẩn hóa chuỗi đầu vào
        const normalized = inputStr.replace(/[;\s]+/g, ',').replace(/,+/g, ',').replace(/^,|,$/g, '');
        const nums = normalized.split(',').map(num => num.trim()).filter(n => n);
        const pairs = [];

        nums.forEach(num => {
            const strNum = num.toString();
            // Kiểm tra xem chuỗi có phải là số hợp lệ và có ít nhất 3 chữ số
            if (strNum.length >= 3 && !isNaN(parseInt(strNum))) {
                // Trích xuất tất cả số 3 chữ số liên tiếp bằng cửa sổ trượt
                for (let i = 0; i <= strNum.length - 3; i++) {
                    const threeDigit = strNum.slice(i, i + 3).padStart(3, '0');
                    pairs.push(threeDigit);
                }
            }
        });

        return { normalized, pairs };
    };

    const { pairs } = parseAndNormalizeInput(input || '');

    // Tạo danh sách tất cả số cho 3D (000-999)
    const allNumbers = Array.from({ length: 1000 }, (_, i) => i.toString().padStart(3, '0'));

    // Tính toán levels
    const numberFrequency = {};
    pairs.forEach(num => {
        numberFrequency[num] = (numberFrequency[num] || 0) + 1;
    });

    const levels = {};
    allNumbers.forEach(num => {
        const freq = numberFrequency[num] || 0;
        if (freq === 0) {
            levels[0] = levels[0] || [];
            levels[0].push(num);
        } else {
            levels[freq] = levels[freq] || [];
            levels[freq].push(num);
        }
    });

    Object.keys(levels).forEach(level => {
        levels[level].sort((a, b) => parseInt(a) - parseInt(b));
    });

    res.json({
        totalSelected: pairs.length,
        levels
    });
};

const calculate4D = (req, res) => {
    const { input } = req.body;

    // Chuẩn hóa input cho 4D
    const parseAndNormalizeInput = (inputStr) => {
        // Chuẩn hóa chuỗi đầu vào
        const normalized = inputStr.replace(/[;\s]+/g, ',').replace(/,+/g, ',').replace(/^,|,$/g, '');
        const nums = normalized.split(',').map(num => num.trim()).filter(n => n);
        const pairs = [];

        nums.forEach(num => {
            const strNum = num.toString();
            // Kiểm tra xem chuỗi có phải là số hợp lệ và có ít nhất 4 chữ số
            if (strNum.length >= 4 && !isNaN(parseInt(strNum))) {
                // Trích xuất tất cả số 4 chữ số liên tiếp bằng cửa sổ trượt
                for (let i = 0; i <= strNum.length - 4; i++) {
                    const fourDigit = strNum.slice(i, i + 4).padStart(4, '0');
                    pairs.push(fourDigit);
                }
            }
        });

        return { normalized, pairs };
    };

    const { pairs } = parseAndNormalizeInput(input || '');

    // Tạo danh sách tất cả số cho 4D (0000-9999)
    const allNumbers = Array.from({ length: 10000 }, (_, i) => i.toString().padStart(4, '0'));

    // Tính toán levels
    const numberFrequency = {};
    pairs.forEach(num => {
        numberFrequency[num] = (numberFrequency[num] || 0) + 1;
    });

    const levels = {};
    allNumbers.forEach(num => {
        const freq = numberFrequency[num] || 0;
        if (freq === 0) {
            levels[0] = levels[0] || [];
            levels[0].push(num);
        } else {
            levels[freq] = levels[freq] || [];
            levels[freq].push(num);
        }
    });

    Object.keys(levels).forEach(level => {
        levels[level].sort((a, b) => parseInt(a) - parseInt(b));
    });

    res.json({
        totalSelected: pairs.length,
        levels
    });
};

const ngaunhien9x = (req, res) => {
    const { input } = req.body;

    // Chuẩn hóa input cho 2D
    const parseAndNormalizeInput = (inputStr) => {
        const normalized = inputStr.replace(/[;\s]+/g, ',').replace(/,+/g, ',').replace(/^,|,$/g, '');
        const nums = normalized.split(',').map(num => num.trim()).filter(n => n);
        const pairs = [];
        nums.forEach(num => {
            const strNum = num.toString();
            if (strNum.length === 2 && !isNaN(parseInt(strNum))) {
                pairs.push(strNum.padStart(2, '0'));
            }
        });
        return { normalized, pairs };
    };

    // Fisher-Yates Shuffle để xáo trộn mảng
    const shuffleArray = (array) => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };

    const { pairs } = parseAndNormalizeInput(input || '');

    // Tính toán levels cho từng dàn
    const levelCounts = [95, 88, 78, 68, 58, 48, 38, 28, 18, 8];
    const numbersPerDan = levelCounts.reduce((sum, count) => sum + count, 0);
    const levelsList = [];
    for (let i = 0; i < pairs.length; i += numbersPerDan) {
        // Lấy dàn và xáo trộn ngẫu nhiên
        const dan = shuffleArray(pairs.slice(i, i + numbersPerDan));
        const levels = {};
        let offset = 0;
        levelCounts.forEach(count => {
            // Gán số và sắp xếp từ nhỏ đến lớn
            levels[count] = dan.slice(offset, offset + count).sort((a, b) => parseInt(a) - parseInt(b));
            offset += count;
        });
        levelsList.push(levels);
    }

    res.json({
        totalSelected: pairs.length,
        levelsList
    });
};

module.exports = {
    calculate3D,
    calculate4D,
    ngaunhien9x
};