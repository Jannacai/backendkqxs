const moment = require('moment');
const XSMT = require('../models/XS_MT.models');
const redis = require('redis');

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});
redisClient.connect().catch(err => console.error('Redis connection error:', err));

// Default provinces list as fallback
const DEFAULT_PROVINCES = [
    'Đà Nẵng', 'Khánh Hòa', 'Huế', 'Phú Yên', 'Đắk Lắk', 'Quảng Nam', 'Quảng Ngãi',
    'Bình Định', 'Quảng Bình', 'Quảng Trị', 'Gia Lai', 'Ninh Thuận', 'Kon Tum', 'Thừa Thiên Huế'
];

// Format date to DD/MM/YYYY
const formatDate = (date) => {
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
};

// Parse date from DD/MM/YYYY or DD-MM-YYYY
const parseDate = (dateStr) => {
    let normalizedStr = dateStr;
    if (dateStr.includes('-')) {
        normalizedStr = dateStr.replace(/-/g, '/');
    }
    if (!normalizedStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(normalizedStr)) {
        throw new Error('Định dạng ngày không hợp lệ. Vui lòng sử dụng DD/MM/YYYY hoặc DD-MM-YYYY.');
    }
    const [day, month, year] = normalizedStr.split('/').map(Number);
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > new Date().getFullYear()) {
        throw new Error('Ngày, tháng hoặc năm không hợp lệ.');
    }
    return new Date(year, month - 1, day);
};

// Remove diacritics from string
function removeDiacritics(str) {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/\s+/g, '-');
}

// Replace 'N/A' with empty string
const sanitizeResult = (result) => (result === 'N/A' ? '' : result);

// Calculate frequencies from results
const calculateFrequencies = async (results, stationOrProvince, days) => {
    const cacheKey = `frequencies:${stationOrProvince}:${days}:all`;
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (redisErr) {
        console.warn('Lỗi khi truy cập Redis frequencies:', redisErr.message);
    }

    const allNumbers = results.reduce((acc, result) => {
        if (!result) return acc;
        return [
            ...acc,
            ...(Array.isArray(result.specialPrize) ? result.specialPrize.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.firstPrize) ? result.firstPrize.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.secondPrize) ? result.secondPrize.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.threePrizes) ? result.threePrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.fourPrizes) ? result.fourPrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.fivePrizes) ? result.fivePrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.sixPrizes) ? result.sixPrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.sevenPrizes) ? result.sevenPrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.eightPrizes) ? result.eightPrizes.filter(num => num && /^\d+$/.test(num)) : []),
        ];
    }, []).map(num => num ? num.slice(-2) : '').filter(num => num && /^\d{2}$/.test(num));

    const freqMap = {};
    allNumbers.forEach(num => {
        freqMap[num] = (freqMap[num] || 0) + 1;
    });
    const frequencies = Object.entries(freqMap)
        .map(([number, count]) => ({ number, count }))
        .sort((a, b) => b.count - a.count);

    try {
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(frequencies));
    } catch (redisErr) {
        console.warn('Lỗi khi lưu Redis frequencies:', redisErr.message);
    }
    return frequencies;
};

// Calculate gan and kep numbers
const calculateLoKepLoGan = async (results, stationOrProvince, days) => {
    const cacheKey = `lokep_logan:${stationOrProvince}:${days}:all`;
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (redisErr) {
        console.warn('Lỗi khi truy cập Redis lokep_logan:', redisErr.message);
    }

    const allNumbers = results.reduce((acc, result) => {
        if (!result) return acc;
        return [
            ...acc,
            ...(Array.isArray(result.specialPrize) ? result.specialPrize.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.firstPrize) ? result.firstPrize.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.secondPrize) ? result.secondPrize.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.threePrizes) ? result.threePrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.fourPrizes) ? result.fourPrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.fivePrizes) ? result.fivePrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.sixPrizes) ? result.sixPrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.sevenPrizes) ? result.sevenPrizes.filter(num => num && /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.eightPrizes) ? result.eightPrizes.filter(num => num && /^\d+$/.test(num)) : []),
        ];
    }, []).map(num => num ? num.slice(-2) : '').filter(num => num && /^\d{2}$/.test(num));

    const loKep = Array.from({ length: 10 }, (_, i) => `${i}${i}`)
        .filter(num => allNumbers.includes(num));
    const loGan = Array.from({ length: 100 }, (_, i) => i.toString().padStart(2, '0'))
        .filter(num => !allNumbers.includes(num));

    const result = { loKep, loGan };

    try {
        await redisClient.setEx(cacheKey, 7200, JSON.stringify(result));
    } catch (redisErr) {
        console.warn('Lỗi khi lưu Redis lokep_logan:', redisErr.message);
    }
    return result;
};

// Calculate gan threshold
const calculateGanThreshold = async (results, numDays) => {
    const allNumbers = results.reduce((acc, result) => {
        if (!result) return acc;
        return [
            ...acc,
            ...(Array.isArray(result.specialPrize) ? result.specialPrize : []),
            ...(Array.isArray(result.firstPrize) ? result.firstPrize : []),
            ...(Array.isArray(result.secondPrize) ? result.secondPrize : []),
            ...(Array.isArray(result.threePrizes) ? result.threePrizes : []),
            ...(Array.isArray(result.fourPrizes) ? result.fourPrizes : []),
            ...(Array.isArray(result.fivePrizes) ? result.fivePrizes : []),
            ...(Array.isArray(result.sixPrizes) ? result.sixPrizes : []),
            ...(Array.isArray(result.sevenPrizes) ? result.sevenPrizes : []),
            ...(Array.isArray(result.eightPrizes) ? result.eightPrizes : []),
        ];
    }, []).map(num => num ? num.slice(-2) : '').filter(num => num);

    const appearanceGaps = {};
    for (let i = 0; i < 100; i++) {
        const num = i.toString().padStart(2, '0');
        let lastAppearance = -1;
        const gaps = [];
        for (let j = 0; j < results.length; j++) {
            if (allNumbers.includes(num) && allNumbers.indexOf(num) >= lastAppearance) {
                gaps.push(j - lastAppearance - 1);
                lastAppearance = j;
            }
        }
        if (gaps.length > 0) {
            appearanceGaps[num] = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
        }
    }
    const avgGap = Object.values(appearanceGaps).reduce((sum, gap) => sum + gap, 0) / Object.keys(appearanceGaps).length || numDays;
    return Math.max(Math.floor(avgGap * 0.8), numDays * 0.5);
};

// Pascal method
const applyPascal = async (prevDayResults, diamondResult, pairResult, historicalPredictions) => {
    if (!prevDayResults[0]) return '';
    const latestResult = prevDayResults[0];
    const specialPrize = Array.isArray(latestResult.specialPrize) && latestResult.specialPrize[0] ? latestResult.specialPrize[0] : '';
    const firstPrize = Array.isArray(latestResult.firstPrize) && latestResult.firstPrize[0] ? latestResult.firstPrize[0] : '';
    if (!specialPrize || !firstPrize || !/^\d+$/.test(specialPrize) || !/^\d+$/.test(firstPrize)) {
        return '';
    }
    const secondLatestResult = prevDayResults[1] || {};
    const secondSpecialPrize = Array.isArray(secondLatestResult.specialPrize) && secondLatestResult.specialPrize[0] ? secondLatestResult.specialPrize[0] : specialPrize;
    const input = ((parseInt(specialPrize.slice(-2)) + parseInt(secondSpecialPrize.slice(-2))) % 100).toString().padStart(2, '0') + firstPrize.slice(-2);
    let result = input.split('').map(Number);
    while (result.length > 2) {
        result = result.slice(0, -1).map((num, i) => (num + result[i + 1]) % 10);
    }
    let pascalResult = result.join('').padStart(2, '0');

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    if (historicalNumbers.includes(pascalResult)) {
        pascalResult = ((parseInt(pascalResult) + 1) % 100).toString().padStart(2, '0');
    }
    return pascalResult || diamondResult || pairResult || '';
};

// Diamond Shape method
const applyDiamondShape = async (allResults, numDays, historicalPredictions) => {
    if (!allResults.length) return '';
    const recentResults = allResults.slice(0, 3);
    const lastTwoDigits = recentResults
        .reduce((acc, result) => {
            if (!result) return acc;
            return [
                ...acc,
                ...(Array.isArray(result.specialPrize) ? result.specialPrize : []),
                ...(Array.isArray(result.firstPrize) ? result.firstPrize : []),
            ];
        }, [])
        .map(prize => prize ? prize.slice(-2) : '').filter(prize => prize);

    let diamondResult = '';
    for (let i = 0; i < lastTwoDigits.length - 2; i++) {
        for (let j = i + 1; j < lastTwoDigits.length - 1; j++) {
            const [a, b, c] = [lastTwoDigits[i], lastTwoDigits[j], lastTwoDigits[j + 1]];
            if (a === c && a !== b && b !== undefined) {
                diamondResult = b.padStart(2, '0');
                break;
            }
            if (b === c && a !== b && a !== undefined) {
                diamondResult = a.padStart(2, '0');
                break;
            }
        }
        if (diamondResult) break;
    }

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    if (historicalNumbers.includes(diamondResult)) {
        diamondResult = ((parseInt(diamondResult) + 1) % 100).toString().padStart(2, '0');
    }
    return diamondResult || lastTwoDigits[0] || '';
};

// Frequency-based Pairs method
const applyFrequencyPairs = async (allResults, historicalPredictions) => {
    if (!allResults.length) return '';
    const recentResults = allResults.slice(0, 5);
    const frequencies = await calculateFrequencies(recentResults, 'xsmt', recentResults.length);
    if (frequencies.length === 0) return '';

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const topPair = frequencies.find(item => !historicalNumbers.includes(item.number)) || frequencies[0];
    return topPair ? topPair.number : '';
};

// Gan and Frequency Combination method
const applyGanFrequency = async (provinceResults, numDays, historicalPredictions) => {
    if (!provinceResults.length) return '';
    const { loGan } = await calculateLoKepLoGan(provinceResults, provinceResults[0].tinh, numDays);
    const frequencies = await calculateFrequencies(provinceResults, provinceResults[0].tinh, numDays);
    const nearGanNumbers = loGan.slice(0, Math.min(5, loGan.length));
    const highFreqNumbers = frequencies.slice(0, 5).map(item => item.number);

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const candidate = nearGanNumbers.find(num => highFreqNumbers.includes(num) && !historicalNumbers.includes(num));
    return candidate || highFreqNumbers.find(num => !historicalNumbers.includes(num)) || highFreqNumbers[0] || '';
};

// Lô rơi method
const applyLoRoi = async (provinceResults, historicalPredictions) => {
    if (provinceResults.length < 2 || !provinceResults[0] || !provinceResults[1]) return '';
    const getLastTwoDigits = (result) => {
        if (!result) return [];
        return [
            ...(Array.isArray(result.specialPrize) ? result.specialPrize : []),
            ...(Array.isArray(result.firstPrize) ? result.firstPrize : []),
        ].map(prize => prize ? prize.slice(-2) : '').filter(prize => prize);
    };

    const lastTwoDigitsRecent = getLastTwoDigits(provinceResults[0]);
    const lastTwoDigitsPrevious = getLastTwoDigits(provinceResults[1]);

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const loRoi = lastTwoDigitsRecent.find(num => lastTwoDigitsPrevious.includes(num) && !historicalNumbers.includes(num));
    return loRoi || lastTwoDigitsRecent.find(num => !historicalNumbers.includes(num)) || '';
};

// Lô kép theo chu kỳ method
const calculateLoKepCycle = async (provinceResults, historicalPredictions) => {
    if (!provinceResults.length) return '';
    const loKep = Array.from({ length: 10 }, (_, i) => `${i}${i}`);
    const allNumbers = provinceResults
        .reduce((acc, result) => {
            if (!result) return acc;
            return [
                ...acc,
                ...(Array.isArray(result.specialPrize) ? result.specialPrize : []),
                ...(Array.isArray(result.firstPrize) ? result.firstPrize : []),
            ];
        }, [])
        .map(num => num ? num.slice(-2) : '').filter(num => num);

    const cycleMap = {};
    loKep.forEach(kep => {
        let lastAppearance = -1;
        const gaps = [];
        for (let i = 0; i < provinceResults.length; i++) {
            if (allNumbers.includes(kep) && allNumbers.indexOf(kep) >= lastAppearance) {
                gaps.push(i - lastAppearance - 1);
                lastAppearance = i;
            }
        }
        cycleMap[kep] = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : provinceResults.length;
    });

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const sortedKep = Object.entries(cycleMap)
        .sort(([, cycleA], [, cycleB]) => cycleA - cycleB)
        .filter(([kep]) => !historicalNumbers.includes(kep));
    return sortedKep[0]?.[0] || loKep[Math.floor(Math.random() * loKep.length)];
};

// Biên độ tần suất method
const applyFrequencyRange = async (allResults, historicalPredictions) => {
    if (!allResults.length) return '';
    const frequencies = await calculateFrequencies(allResults, 'xsmt', allResults.length);
    const counts = frequencies.map(f => f.count);
    const avgCount = counts.reduce((sum, c) => sum + c, 0) / counts.length || 1;

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const midRange = frequencies
        .filter(f => Math.abs(f.count - avgCount) < avgCount * 0.3)
        .filter(f => !historicalNumbers.includes(f.number));
    return midRange.length > 0 ? midRange[0].number : frequencies.find(f => !historicalNumbers.includes(f.number))?.number || '';
};

// Chu kỳ số method
const applyNumberCycle = async (provinceResults, historicalPredictions) => {
    if (!provinceResults.length) return '';
    const allNumbers = provinceResults
        .reduce((acc, result) => {
            if (!result) return acc;
            return [
                ...acc,
                ...(Array.isArray(result.specialPrize) ? result.specialPrize : []),
                ...(Array.isArray(result.firstPrize) ? result.firstPrize : []),
            ];
        }, [])
        .map(num => num ? num.slice(-2) : '').filter(num => num);

    const cycleMap = {};
    for (let i = 0; i < 100; i++) {
        const num = i.toString().padStart(2, '0');
        let lastAppearance = -1;
        const gaps = [];
        for (let j = 0; j < provinceResults.length; j++) {
            if (allNumbers.includes(num) && allNumbers.indexOf(num) >= lastAppearance) {
                gaps.push(j - lastAppearance - 1);
                lastAppearance = j;
            }
        }
        cycleMap[num] = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : provinceResults.length;
    }

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const sortedCycles = Object.entries(cycleMap)
        .sort(([, cycleA], [, cycleB]) => cycleA - cycleB)
        .filter(([num]) => !historicalNumbers.includes(num));
    return sortedCycles[0]?.[0] || '';
};

// Tổng các chữ số
const applySumDigits = async (prevDayResults, historicalPredictions) => {
    if (!prevDayResults[0]) return '';
    const latestResult = prevDayResults[0];
    const specialPrize = Array.isArray(latestResult.specialPrize) && latestResult.specialPrize[0] ? latestResult.specialPrize[0] : '';
    const firstPrize = Array.isArray(latestResult.firstPrize) && latestResult.firstPrize[0] ? latestResult.firstPrize[0] : '';
    if (!specialPrize || !firstPrize || !/^\d+$/.test(specialPrize) || !/^\d+$/.test(firstPrize)) {
        return '';
    }
    const specialSum = specialPrize.split('').reduce((sum, digit) => sum + parseInt(digit), 0);
    const firstSum = firstPrize.split('').reduce((sum, digit) => sum + parseInt(digit), 0);
    let totalSum = (specialSum + firstSum) % 100;

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    if (historicalNumbers.includes(totalSum.toString().padStart(2, '0'))) {
        totalSum = (totalSum + 1) % 100;
    }
    return totalSum.toString().padStart(2, '0');
};

// Đảo ngược
const applyReverse = async (prevDayResults, historicalPredictions) => {
    if (!prevDayResults[0]) return '';
    const latestResult = prevDayResults[0];
    const specialPrize = Array.isArray(latestResult.specialPrize) && latestResult.specialPrize[0] ? latestResult.specialPrize[0] : '';
    if (!specialPrize || !/^\d+$/.test(specialPrize)) {
        return '';
    }
    let reversed = specialPrize.slice(-2).split('').reverse().join('');

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    if (historicalNumbers.includes(reversed)) {
        reversed = ((parseInt(reversed) + 1) % 100).toString().padStart(2, '0');
    }
    return reversed;
};

// Khoảng cách
const applyDistance = async (prevDayResults, historicalPredictions) => {
    if (prevDayResults.length < 2 || !prevDayResults[0] || !prevDayResults[1]) return '';
    const latestSpecial = prevDayResults[0].specialPrize?.[0] ? parseInt(prevDayResults[0].specialPrize[0].slice(-2)) : null;
    const prevSpecial = prevDayResults[1].specialPrize?.[0] ? parseInt(prevDayResults[1].specialPrize[0].slice(-2)) : null;
    if (!latestSpecial || !prevSpecial) return '';
    let distance = Math.abs(latestSpecial - prevSpecial) % 100;

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    if (historicalNumbers.includes(distance.toString().padStart(2, '0'))) {
        distance = (distance + 1) % 100;
    }
    return distance.toString().padStart(2, '0');
};

// Recent Trend Analysis
const applyRecentTrend = async (allResults, historicalPredictions) => {
    if (allResults.length < 3) return '';
    const recentResults = allResults.slice(0, 3);
    const frequencies = await calculateFrequencies(recentResults, 'xsmt', recentResults.length);
    const topRecentNumbers = frequencies.slice(0, 3).map(item => item.number);

    const numberTrends = {};
    for (let i = 0; i < recentResults.length; i++) {
        const dayNumbers = recentResults[i]
            ? [
                ...(Array.isArray(recentResults[i].specialPrize) ? recentResults[i].specialPrize : []),
                ...(Array.isArray(recentResults[i].firstPrize) ? recentResults[i].firstPrize : []),
            ].map(num => num ? num.slice(-2) : '').filter(num => num)
            : [];
        dayNumbers.forEach(num => {
            if (!numberTrends[num]) numberTrends[num] = [];
            numberTrends[num].push(i);
        });
    }

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const trendingNumbers = Object.entries(numberTrends)
        .filter(([num, appearances]) => appearances.includes(0) && !appearances.includes(2))
        .map(([num]) => num)
        .filter(num => !historicalNumbers.includes(num));

    return trendingNumbers.length > 0 ? trendingNumbers[0] : topRecentNumbers.find(num => !historicalNumbers.includes(num)) || topRecentNumbers[0] || '';
};

// Calculate historical hit rates
const calculateHitRates = async (results, predictions) => {
    const hitRates = {
        Pascal: 0,
        'Hình Quả Trám': 0,
        'Tần suất lô cặp': 0,
        'Lô gan kết hợp': 0,
        'Lô rơi': 0,
        'Lô kép theo chu kỳ': 0,
        'Biên độ tần suất': 0,
        'Chu kỳ số': 0,
        'Tổng các chữ số': 0,
        'Đảo ngược': 0,
        'Khoảng cách': 0,
        'Xu hướng gần đây': 0,
    };

    if (!results.length) {
        const defaultWeight = 1 / Object.keys(hitRates).length;
        Object.keys(hitRates).forEach(method => {
            hitRates[method] = defaultWeight;
        });
        return hitRates;
    }

    for (const result of results) {
        if (!result) continue;
        const actualNumbers = [
            ...(Array.isArray(result.specialPrize) ? result.specialPrize : []),
            ...(Array.isArray(result.firstPrize) ? result.firstPrize : []),
            ...(Array.isArray(result.secondPrize) ? result.secondPrize : []),
            ...(Array.isArray(result.threePrizes) ? result.threePrizes : []),
            ...(Array.isArray(result.fourPrizes) ? result.fourPrizes : []),
            ...(Array.isArray(result.fivePrizes) ? result.fivePrizes : []),
            ...(Array.isArray(result.sixPrizes) ? result.sixPrizes : []),
            ...(Array.isArray(result.sevenPrizes) ? result.sevenPrizes : []),
            ...(Array.isArray(result.eightPrizes) ? result.eightPrizes : []),
        ].map(num => num ? num.slice(-2) : '').filter(num => num);

        predictions.forEach(prediction => {
            if (prediction.number && actualNumbers.includes(prediction.number)) {
                hitRates[prediction.method] += 1 / results.length;
            }
        });
    }

    const total = Object.values(hitRates).reduce((sum, rate) => sum + rate, 0) || 1;
    Object.keys(hitRates).forEach(method => {
        hitRates[method] = total ? hitRates[method] / total : 1 / Object.keys(hitRates).length;
    });

    return hitRates;
};

// Combine predictions
const combinePredictions = async (predictions, provinceResults, allResults, historicalPredictions, province) => {
    const decodedProvince = removeDiacritics(province);
    const provinceResultsFiltered = provinceResults.filter(r => removeDiacritics(r.tinh) === decodedProvince);
    const hitRates = await calculateHitRates(provinceResultsFiltered, predictions);

    const methodGroups = {
        'Pascal': 'group1',
        'Tổng các chữ số': 'group1',
        'Đảo ngược': 'group1',
        'Khoảng cách': 'group1',
        'Hình Quả Trám': 'group2',
        'Tần suất lô cặp': 'group2',
        'Biên độ tần suất': 'group2',
        'Xu hướng gần đây': 'group2',
        'Lô gan kết hợp': 'group3',
        'Lô rơi': 'group3',
        'Lô kép theo chu kỳ': 'group3',
        'Chu kỳ số': 'group3',
    };

    const groupWeights = {
        group1: 1.5,
        group2: 1.0,
        group3: 1.2,
    };

    const provinceWeights = {
        'hue': { loKepCycle: 1.2, ganFreq: 0.9 },
        'phu-yen': { loKepCycle: 0.8, ganFreq: 1.1 },
        'da-nang': { loKepCycle: 1.0, ganFreq: 1.0 },
    };

    const scoreMap = {};
    predictions.forEach(prediction => {
        if (prediction.number) {
            const group = methodGroups[prediction.method] || 'group2';
            const groupWeight = groupWeights[group] || 1.0;
            const provinceWeight = provinceWeights[decodedProvince]?.[prediction.method] || 1.0;
            scoreMap[prediction.number] = (scoreMap[prediction.number] || 0) + hitRates[prediction.method] * groupWeight * provinceWeight;
        }
    });

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const sortedScores = Object.entries(scoreMap)
        .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
        .filter(([num]) => !historicalNumbers.includes(num));

    const topNumber = sortedScores[0]?.[0];
    const additionalSuggestions = sortedScores.slice(1, 4).map(([num]) => num.padStart(2, '0'));

    return {
        topNumber: topNumber ? topNumber.padStart(2, '0') : predictions.find(p => p.number && !historicalNumbers.includes(p.number))?.number || predictions.find(p => p.number)?.number || '',
        additionalSuggestions,
    };
};

// Get provinces for a specific date
async function getProvinces(req, res) {
    try {
        const { date = formatDate(new Date()) } = req.query;
        const drawDate = moment(date, 'DD/MM/YYYY');
        if (!drawDate.isValid()) {
            return res.status(400).json({ error: 'Ngày không hợp lệ.', suggestedDate: moment().format('DD/MM/YYYY') });
        }

        const currentTime = new Date();
        const thresholdTime = new Date(currentTime);
        thresholdTime.setHours(18, 30, 0, 0);
        const isAfterResultTime = currentTime > thresholdTime;
        const isToday = formatDate(drawDate) === formatDate(currentTime);

        let targetDate = drawDate;
        if (isToday && isAfterResultTime) {
            targetDate = moment(drawDate).add(1, 'days');
        }

        const cacheKey = `provinces:${formatDate(targetDate)}`;
        let provinces;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                provinces = JSON.parse(cached);
                console.log(`Trả về tỉnh từ cache: ${cacheKey}, provinces: ${provinces}`);
                return res.status(200).json(provinces);
            }
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis provinces:', redisErr.message);
        }

        const dayOfWeek = targetDate.format('dddd');
        const schedule = {
            'Monday': ['Huế', 'Phú Yên'],
            'Tuesday': ['Đắk Lắk', 'Quảng Nam'],
            'Wednesday': ['Đà Nẵng', 'Khánh Hòa'],
            'Thursday': ['Bình Định', 'Quảng Trị', 'Quảng Bình'],
            'Friday': ['Gia Lai', 'Ninh Thuận'],
            'Saturday': ['Đà Nẵng', 'Quảng Ngãi', 'Đắk Nông'],
            'Sunday': ['Kon Tum', 'Khánh Hòa', 'Thừa Thiên Huế'],
        };
        provinces = schedule[dayOfWeek] || DEFAULT_PROVINCES;

        try {
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(provinces));
            console.log(`Đã cache danh sách tỉnh: ${cacheKey}, provinces: ${provinces}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu Redis provinces:', redisErr.message);
        }

        res.status(200).json(provinces);
    } catch (error) {
        console.error('Error in getProvinces:', error.message);
        res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
    }
}

// Fetch historical predictions
const getHistoricalPredictions = async (targetDate, numDays) => {
    const history = [];
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    const startOfPeriod = new Date(endOfDay);
    startOfPeriod.setDate(startOfPeriod.getDate() - numDays + 1);
    startOfPeriod.setHours(0, 0, 0, 0);

    const results = await XSMT.find({
        drawDate: { $gte: startOfPeriod, $lte: endOfDay },
        station: 'xsmt',
    })
        .select('drawDate tinh specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes eightPrizes')
        .sort({ drawDate: -1 })
        .lean();

    const currentTime = new Date();
    const isBeforeResultTime = currentTime.getHours() < 18 || (currentTime.getHours() === 18 && currentTime.getMinutes() < 30);
    const today = formatDate(currentTime);

    const groupedByDate = results.reduce((acc, result) => {
        const dateStr = formatDate(result.drawDate);
        if (!acc[dateStr]) acc[dateStr] = [];
        acc[dateStr].push(result);
        return acc;
    }, {});

    for (let i = 0; i < Math.min(numDays, 10); i++) {
        const pastDate = new Date(targetDate);
        pastDate.setDate(pastDate.getDate() - i);
        const formattedPastDate = formatDate(pastDate);

        if (formattedPastDate === today && isBeforeResultTime) {
            continue;
        }

        const dayResults = groupedByDate[formattedPastDate] || [];
        if (!dayResults.length) continue;

        for (const result of dayResults) {
            const tinh = removeDiacritics(result.tinh);
            const cacheKey = `bachthu:predict:${formattedPastDate}:days:${numDays}:tinh:${tinh}`;
            let pastPrediction;
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    pastPrediction = JSON.parse(cached);
                }
            } catch (redisErr) {
                console.warn('Lỗi khi truy cập Redis lịch sử:', redisErr.message);
            }

            if (!pastPrediction) {
                const pastEndOfDay = new Date(pastDate);
                pastEndOfDay.setDate(pastEndOfDay.getDate() - 1);
                pastEndOfDay.setHours(23, 59, 59, 999);
                const pastStartOfPeriod = new Date(pastEndOfDay);
                pastStartOfPeriod.setDate(pastStartOfPeriod.getDate() - numDays + 1);
                pastStartOfPeriod.setHours(0, 0, 0, 0);

                const prevDay = moment(pastDate).subtract(1, 'days');
                const prevDayResults = await XSMT.find({
                    drawDate: { $gte: prevDay.startOf('day').toDate(), $lte: prevDay.endOf('day').toDate() },
                    station: 'xsmt',
                }).lean();

                const provinceResults = await XSMT.find({
                    drawDate: { $gte: pastStartOfPeriod, $lte: pastEndOfDay },
                    station: 'xsmt',
                    tinh: tinh,
                }).lean().sort({ drawDate: -1 });

                const allResults = await XSMT.find({
                    drawDate: { $gte: pastStartOfPeriod, $lte: pastEndOfDay },
                    station: 'xsmt',
                }).lean().sort({ drawDate: -1 });

                const combinedResults = [
                    ...prevDayResults,
                    ...provinceResults,
                    ...allResults.filter(r => !provinceResults.some(pr => pr._id.toString() === r._id.toString())),
                ].sort((a, b) => new Date(b.drawDate) - new Date(a.drawDate)).slice(0, numDays);

                if (combinedResults.length === 0) continue;

                const pastHistory = await getHistoricalPredictions(new Date(pastDate.getTime() - 24 * 60 * 60 * 1000), numDays);

                const diamondResult = await applyDiamondShape(combinedResults, numDays, pastHistory);
                const pairResult = await applyFrequencyPairs(combinedResults, pastHistory);
                const pascalResult = await applyPascal(prevDayResults, diamondResult, pairResult, pastHistory);
                const ganFreqResult = await applyGanFrequency(provinceResults, numDays, pastHistory);
                const loRoiResult = await applyLoRoi(provinceResults, pastHistory);
                const loKepResult = await calculateLoKepCycle(provinceResults, pastHistory);
                const freqRangeResult = await applyFrequencyRange(combinedResults, pastHistory);
                const numberCycleResult = await applyNumberCycle(provinceResults, pastHistory);
                const sumDigitsResult = await applySumDigits(prevDayResults, pastHistory);
                const reverseResult = await applyReverse(prevDayResults, pastHistory);
                const distanceResult = await applyDistance(prevDayResults, pastHistory);
                const recentTrendResult = await applyRecentTrend(combinedResults, pastHistory);

                const predictions = [
                    { method: 'Pascal', number: pascalResult, frame: pascalResult ? '3 ngày' : '' },
                    { method: 'Hình Quả Trám', number: diamondResult, frame: diamondResult ? '5 ngày' : '' },
                    { method: 'Tần suất lô cặp', number: pairResult, frame: pairResult ? '3 ngày' : '' },
                    { method: 'Lô gan kết hợp', number: ganFreqResult, frame: ganFreqResult ? '5 ngày' : '' },
                    { method: 'Lô rơi', number: loRoiResult, frame: loRoiResult ? '2 ngày' : '' },
                    { method: 'Lô kép theo chu kỳ', number: loKepResult, frame: loKepResult ? '7 ngày' : '' },
                    { method: 'Biên độ tần suất', number: freqRangeResult, frame: freqRangeResult ? '3 ngày' : '' },
                    { method: 'Chu kỳ số', number: numberCycleResult, frame: numberCycleResult ? '5 ngày' : '' },
                    { method: 'Tổng các chữ số', number: sumDigitsResult, frame: sumDigitsResult ? '1 ngày' : '' },
                    { method: 'Đảo ngược', number: reverseResult, frame: reverseResult ? '1 ngày' : '' },
                    { method: 'Khoảng cách', number: distanceResult, frame: distanceResult ? '2 ngày' : '' },
                    { method: 'Xu hướng gần đây', number: recentTrendResult, frame: recentTrendResult ? '3 ngày' : '' },
                ].map(pred => ({
                    ...pred,
                    number: sanitizeResult(pred.number),
                    frame: sanitizeResult(pred.frame),
                }));

                const { topNumber, additionalSuggestions } = await combinePredictions(predictions, provinceResults, combinedResults, pastHistory, result.tinh);

                pastPrediction = {
                    predictionDate: formattedPastDate,
                    predictions,
                    combinedPrediction: sanitizeResult(topNumber),
                    additionalSuggestions: additionalSuggestions.map(sanitizeResult),
                };

                try {
                    await redisClient.setEx(cacheKey, 86400, JSON.stringify(pastPrediction));
                } catch (redisErr) {
                    console.warn('Lỗi khi lưu Redis lịch sử:', redisErr.message);
                }
            }

            const actualResult = results.find(r => formatDate(r.drawDate) === formattedPastDate && removeDiacritics(r.tinh) === tinh);
            const actualNumbers = actualResult
                ? [
                    ...(Array.isArray(actualResult.specialPrize) ? actualResult.specialPrize : []),
                    ...(Array.isArray(actualResult.firstPrize) ? actualResult.firstPrize : []),
                    ...(Array.isArray(actualResult.secondPrize) ? actualResult.secondPrize : []),
                    ...(Array.isArray(actualResult.threePrizes) ? actualResult.threePrizes : []),
                    ...(Array.isArray(actualResult.fourPrizes) ? actualResult.fourPrizes : []),
                    ...(Array.isArray(actualResult.fivePrizes) ? actualResult.fivePrizes : []),
                    ...(Array.isArray(actualResult.sixPrizes) ? actualResult.sixPrizes : []),
                    ...(Array.isArray(actualResult.sevenPrizes) ? actualResult.sevenPrizes : []),
                    ...(Array.isArray(actualResult.eightPrizes) ? actualResult.eightPrizes : []),
                ].map(num => num ? num.slice(-2) : '').filter(num => num)
                : [];

            const predictedNumbers = pastPrediction.predictions
                .filter(p => p.number)
                .map(p => p.number);
            const matchingNumbers = actualNumbers.filter(num => predictedNumbers.includes(num));

            const isHit = matchingNumbers.length > 0;

            history.push({
                date: formattedPastDate,
                provinces: result.tinh,
                predictions: pastPrediction.predictions,
                combinedPrediction: pastPrediction.combinedPrediction,
                actualNumbers: matchingNumbers,
                isHit,
            });
        }
    }

    return history.sort((a, b) => new Date(b.date.split('/').reverse().join('-')) - new Date(a.date.split('/').reverse().join('-')));
};

// Fetch bạch thủ prediction
async function getBachThuMT(req, res) {
    try {
        const { date, days = '10', tinh } = req.query;
        const numDays = parseInt(days);
        const validDays = [3, 5, 7, 10, 14];
        if (!validDays.includes(numDays)) {
            return res.status(400).json({ error: 'Số ngày không hợp lệ. Phải là 3, 5, 7, 10 hoặc 14.' });
        }
        if (!date || !/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
            return res.status(400).json({ error: 'Định dạng ngày không hợp lệ. Sử dụng DD/MM/YYYY.', suggestedDate: moment().format('DD/MM/YYYY') });
        }
        if (!tinh || tinh.trim() === '') {
            return res.status(400).json({ error: 'Tỉnh (tinh) là bắt buộc.' });
        }

        const drawDate = moment(date, 'DD/MM/YYYY');
        if (!drawDate.isValid()) {
            return res.status(400).json({ error: 'Ngày không hợp lệ.', suggestedDate: moment().format('DD/MM/YYYY') });
        }

        const currentTime = new Date();
        const today = formatDate(currentTime);
        const lastUpdateKey = `lastUpdate:${today}:${tinh}`;
        const thresholdTime = new Date(currentTime);
        thresholdTime.setHours(18, 30, 0, 0);
        const isAfterResultTime = currentTime > thresholdTime;

        if (isAfterResultTime) {
            const lastUpdate = await redisClient.get(lastUpdateKey);
            if (!lastUpdate) {
                const keys = await redisClient.keys(`bachthu:predict:*:tinh:${tinh}`);
                const freqKeys = await redisClient.keys(`frequencies:xsmt:*`);
                const ganKeys = await redisClient.keys(`lokep_logan:xsmt:*`);
                await Promise.all([
                    keys.length > 0 ? redisClient.del(keys) : Promise.resolve(),
                    freqKeys.length > 0 ? redisClient.del(freqKeys) : Promise.resolve(),
                    ganKeys.length > 0 ? redisClient.del(ganKeys) : Promise.resolve(),
                ]);
                await redisClient.setEx(lastUpdateKey, 86400, 'true');
                console.log(`Dữ liệu cache đã được xóa và cập nhật vào ${currentTime} cho ngày ${today}, tỉnh ${tinh}`);
            }
        }

        const isCurrentDate = formatDate(drawDate) === today;
        const predictionDate = isCurrentDate && isAfterResultTime
            ? formatDate(new Date(currentTime.getTime() + 24 * 60 * 60 * 1000))
            : formatDate(drawDate);

        const decodedTinh = removeDiacritics(decodeURIComponent(tinh));
        const cacheKey = `bachthu:predict:${date}:days:${days}:tinh:${decodedTinh}`;
        let cached;
        try {
            cached = await redisClient.get(cacheKey);
            if (cached) {
                console.log(`Trả về dữ liệu từ cache: ${cacheKey}`);
                return res.status(200).json(JSON.parse(cached));
            }
        } catch (redisErr) {
            console.warn('Lỗi khi truy cập Redis cache:', redisErr.message);
        }

        const prevDay = moment(drawDate).subtract(1, 'days');
        const startDate = moment(drawDate).subtract(numDays, 'days');

        console.log(`Tìm dữ liệu cho tỉnh ${decodedTinh} từ ${startDate.format('DD/MM/YYYY')} đến ${drawDate.format('DD/MM/YYYY')}`);
        const prevDayResults = await XSMT.find({
            drawDate: { $gte: prevDay.startOf('day').toDate(), $lte: prevDay.endOf('day').toDate() },
            station: 'xsmt',
        }).lean();

        const provinceResults = await XSMT.find({
            drawDate: { $gte: startDate.toDate(), $lte: drawDate.toDate() },
            station: 'xsmt',
            tinh: decodedTinh,
        }).lean().sort({ drawDate: -1 });

        const allResults = await XSMT.find({
            drawDate: { $gte: startDate.toDate(), $lte: drawDate.toDate() },
            station: 'xsmt',
        }).lean().sort({ drawDate: -1 });

        console.log(`Tìm thấy ${provinceResults.length} bản ghi cho tỉnh ${decodedTinh}, ${allResults.length} bản ghi tổng cộng`);
        provinceResults.forEach((result, index) => {
            console.log(`Bản ghi ${index + 1} (${formatDate(result.drawDate)}):`, {
                specialPrize: result.specialPrize,
                firstPrize: result.firstPrize,
                secondPrize: result.secondPrize,
                threePrizes: result.threePrizes,
                fourPrizes: result.fourPrizes,
                fivePrizes: result.fivePrizes,
                sixPrizes: result.sixPrizes,
                sevenPrizes: result.sevenPrizes,
                eightPrizes: result.eightPrizes,
            });
        });

        if (!provinceResults.length && !allResults.length) {
            return res.status(404).json({
                error: `Không tìm thấy dữ liệu cho tỉnh ${decodedTinh} trong khoảng thời gian từ ${formatDate(startDate)} đến ${formatDate(drawDate)}.`,
                suggestedDate: moment().format('DD/MM/YYYY'),
            });
        }

        const validProvinceResults = provinceResults.filter(result => {
            if (!result) return false;
            const hasValidPrize = [
                result.specialPrize,
                result.firstPrize,
                result.secondPrize,
                result.threePrizes,
                result.fourPrizes,
                result.fivePrizes,
                result.sixPrizes,
                result.sevenPrizes,
                result.eightPrizes,
            ].some(prize => Array.isArray(prize) && prize.length > 0);
            if (!hasValidPrize) {
                console.log(`Loại bỏ bản ghi (${formatDate(result.drawDate)}): Không có giải nào hợp lệ`);
            }
            return hasValidPrize;
        });

        console.log(`Dữ liệu hợp lệ sau khi lọc cho tỉnh ${decodedTinh}: ${validProvinceResults.length} bản ghi`);

        if (validProvinceResults.length === 0) {
            return res.status(404).json({
                error: `Không có dữ liệu xổ số hợp lệ trong ${numDays} ngày trước ngày ${date} cho tỉnh ${decodedTinh}. Vui lòng kiểm tra dữ liệu MongoDB.`,
                suggestedDate: moment().format('DD/MM/YYYY'),
                debug: {
                    provinceResultsCount: provinceResults.length,
                    provinceResults: provinceResults.map(r => ({
                        date: formatDate(r.drawDate),
                        prizes: {
                            specialPrize: r.specialPrize,
                            firstPrize: r.firstPrize,
                            secondPrize: r.secondPrize,
                            threePrizes: r.threePrizes,
                            fourPrizes: r.fourPrizes,
                            fivePrizes: r.fivePrizes,
                            sixPrizes: r.sixPrizes,
                            sevenPrizes: r.sevenPrizes,
                            eightPrizes: r.eightPrizes,
                        },
                    })),
                },
            });
        }

        const validResults = [
            ...prevDayResults,
            ...validProvinceResults,
            ...allResults.filter(r => !validProvinceResults.some(pr => pr._id.toString() === r._id.toString())),
        ].sort((a, b) => new Date(b.drawDate) - new Date(a.drawDate)).slice(0, numDays);

        const history = await getHistoricalPredictions(drawDate.toDate(), numDays);

        const diamondResult = await applyDiamondShape(allResults, numDays, history);
        const pairResult = await applyFrequencyPairs(allResults, history);
        const pascalResult = await applyPascal(prevDayResults, diamondResult, pairResult, history);
        const ganFreqResult = await applyGanFrequency(validProvinceResults, numDays, history);
        const loRoiResult = await applyLoRoi(validProvinceResults, history);
        const loKepResult = await calculateLoKepCycle(validProvinceResults, history);
        const freqRangeResult = await applyFrequencyRange(allResults, history);
        const numberCycleResult = await applyNumberCycle(validProvinceResults, history);
        const sumDigitsResult = await applySumDigits(prevDayResults, history);
        const reverseResult = await applyReverse(prevDayResults, history);
        const distanceResult = await applyDistance(prevDayResults, history);
        const recentTrendResult = await applyRecentTrend(allResults, history);

        const predictions = [
            { method: 'Pascal', number: pascalResult, frame: pascalResult ? '3 ngày' : '' },
            { method: 'Hình Quả Trám', number: diamondResult, frame: diamondResult ? '5 ngày' : '' },
            { method: 'Tần suất lô cặp', number: pairResult, frame: pairResult ? '3 ngày' : '' },
            { method: 'Lô gan kết hợp', number: ganFreqResult, frame: ganFreqResult ? '5 ngày' : '' },
            { method: 'Lô rơi', number: loRoiResult, frame: loRoiResult ? '2 ngày' : '' },
            { method: 'Lô kép theo chu kỳ', number: loKepResult, frame: loKepResult ? '7 ngày' : '' },
            { method: 'Biên độ tần suất', number: freqRangeResult, frame: freqRangeResult ? '3 ngày' : '' },
            { method: 'Chu kỳ số', number: numberCycleResult, frame: numberCycleResult ? '5 ngày' : '' },
            { method: 'Tổng các chữ số', number: sumDigitsResult, frame: sumDigitsResult ? '1 ngày' : '' },
            { method: 'Đảo ngược', number: reverseResult, frame: reverseResult ? '1 ngày' : '' },
            { method: 'Khoảng cách', number: distanceResult, frame: distanceResult ? '2 ngày' : '' },
            { method: 'Xu hướng gần đây', number: recentTrendResult, frame: recentTrendResult ? '3 ngày' : '' },
        ].map(pred => ({
            ...pred,
            number: sanitizeResult(pred.number),
            frame: sanitizeResult(pred.frame),
        }));

        const { topNumber, additionalSuggestions } = await combinePredictions(predictions, validProvinceResults, allResults, history, decodedTinh);

        const getLastTwoDigits = (number) => {
            if (!number || typeof number !== 'string' || !/^\d+$/.test(number)) return null;
            const str = number.toString();
            return str.length >= 2 ? parseInt(str.slice(-2)) : parseInt(str);
        };

        const allPrizes = allResults.reduce((acc, result) => {
            if (!result) return acc;
            return [
                ...acc,
                ...(Array.isArray(result.specialPrize) ? result.specialPrize : []),
                ...(Array.isArray(result.firstPrize) ? result.firstPrize : []),
                ...(Array.isArray(result.secondPrize) ? result.secondPrize : []),
                ...(Array.isArray(result.threePrizes) ? result.threePrizes : []),
                ...(Array.isArray(result.fourPrizes) ? result.fourPrizes : []),
                ...(Array.isArray(result.fivePrizes) ? result.fivePrizes : []),
                ...(Array.isArray(result.sixPrizes) ? result.sixPrizes : []),
                ...(Array.isArray(result.sevenPrizes) ? result.sevenPrizes : []),
                ...(Array.isArray(result.eightPrizes) ? result.eightPrizes : []),
            ];
        }, []);

        const numbers = [...new Set(
            allPrizes
                .map(prize => getLastTwoDigits(prize))
                .filter(num => num !== null && num >= 0 && num <= 99)
        )].map(num => num.toString().padStart(2, '0'));

        let provinceFrequencies = (await calculateFrequencies(validProvinceResults, decodedTinh, numDays))
            .filter(freq => freq.count >= 2)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        let allFrequencies = (await calculateFrequencies(allResults, 'xsmt', numDays))
            .filter(freq => freq.count >= 3)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const uniqueBachThuLo = [...new Set([
            ...provinceFrequencies.map(freq => freq.number),
            ...allFrequencies.map(freq => freq.number),
        ])].slice(0, 10);

        let specialPrizes = [];
        let firstPrizes = [];
        if (prevDayResults.length > 0) {
            specialPrizes = prevDayResults
                .filter(result => Array.isArray(result.specialPrize) && result.specialPrize.length > 0)
                .map(result => result.specialPrize[0])
                .filter(prize => prize && /^\d+$/.test(prize));
            firstPrizes = prevDayResults
                .filter(result => Array.isArray(result.firstPrize) && result.firstPrize.length > 0)
                .map(result => result.firstPrize[0])
                .filter(prize => prize && /^\d+$/.test(prize));
        }

        const response = {
            predictionDate,
            dataRange: {
                from: formatDate(startDate),
                to: formatDate(drawDate),
                days: numDays,
                actualDays: validProvinceResults.length,
            },
            predictions,
            combinedPrediction: sanitizeResult(topNumber),
            additionalSuggestions: additionalSuggestions.map(sanitizeResult),
            history,
            totalNumbers: numbers.length,
            numbers,
            frequencies: allFrequencies,
            relatedNumbers: await calculateLoKepLoGan(validProvinceResults, decodedTinh, numDays),
            bachThuLo: uniqueBachThuLo,
            metadata: {
                predictionFor: predictionDate,
                dataFrom: formatDate(startDate),
                dataTo: formatDate(prevDay),
                totalDraws: validProvinceResults.length,
                specialPrize: specialPrizes.length > 0 ? specialPrizes.join(', ') : 'Chưa có dữ liệu',
                firstPrize: firstPrizes.length > 0 ? firstPrizes.join(', ') : 'Chưa có dữ liệu',
                message: validProvinceResults.length < numDays
                    ? `Dự đoán bạch thủ XSMT cho tỉnh ${decodedTinh} ngày ${predictionDate} dựa trên dữ liệu từ ${formatDate(startDate)} đến ${formatDate(drawDate)} (chỉ tìm thấy ${validProvinceResults.length} ngày).`
                    : `Dự đoán bạch thủ XSMT cho tỉnh ${decodedTinh} ngày ${predictionDate} dựa trên dữ liệu từ ${formatDate(startDate)} đến ${formatDate(drawDate)}.`,
                frequencyDays: numDays,
                province: decodedTinh,
            },
        };

        try {
            await redisClient.del(cacheKey);
            await redisClient.setEx(cacheKey, isCurrentDate ? 3600 : 7200, JSON.stringify(response));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu Redis cache:', redisErr.message);
        }

        res.status(200).json(response);
    } catch (error) {
        console.error('Error in getBachThuMT:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu') || error.message.includes('Dữ liệu xổ số không hợp lệ')) {
            res.status(404).json({ error: error.message, suggestedDate: moment().format('DD/MM/YYYY') });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
}

module.exports = { getBachThuMT, getProvinces };