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

    // Danh sách các bậc
    const levelCounts = [95, 88, 78, 68, 58, 48, 38, 28, 18, 8];
    const levelsList = [];

    // Tính toán levels cho từng dàn
    const numbersPerDan = levelCounts.reduce((sum, count) => sum + count, 0);
    for (let i = 0; i < pairs.length; i += numbersPerDan) {
        const levels = {};
        let currentPool = shuffleArray(pairs.slice(i, i + numbersPerDan)); // Kho số ban đầu cho dàn

        levelCounts.forEach(count => {
            // Lấy số ngẫu nhiên từ kho hiện tại và sắp xếp từ nhỏ đến lớn
            const selectedNumbers = shuffleArray(currentPool).slice(0, count).sort((a, b) => parseInt(a) - parseInt(b));
            levels[count] = selectedNumbers;
            // Cập nhật kho cho bậc tiếp theo bằng cách lấy chính số đã chọn
            currentPool = selectedNumbers;
        });

        levelsList.push(levels);
    }

    res.json({
        totalSelected: pairs.length,
        levelsList
    });
};

module.exports = {
    ngaunhien9x
};