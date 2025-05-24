const XSMB = require('../models/XS_MB.models');
const { getRedisClient } = require('../utils/redis');

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

// Replace 'N/A' with empty string
const sanitizeResult = (result) => (result === 'N/A' ? '' : result);

// Calculate frequencies from results
const calculateFrequencies = async (results, station, days, redisClient) => {
    const cacheKey = `frequencies:${station}:${days}`;
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
            ...(Array.isArray(result.specialPrize) ? result.specialPrize.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.firstPrize) ? result.firstPrize.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.secondPrize) ? result.secondPrize.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.threePrizes) ? result.threePrizes.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.fourPrizes) ? result.fourPrizes.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.fivePrizes) ? result.fivePrizes.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.sixPrizes) ? result.sixPrizes.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.sevenPrizes) ? result.sevenPrizes.filter(num => /^\d+$/.test(num)) : []),
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

// Calculate gan numbers
const calculateGanNumbers = async (results, station, days, redisClient) => {
    const cacheKey = `gan:${station}:${days}`;
    try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (redisErr) {
        console.warn('Lỗi khi truy cập Redis gan:', redisErr.message);
    }

    const allNumbers = results.reduce((acc, result) => {
        if (!result) return acc;
        return [
            ...acc,
            ...(Array.isArray(result.specialPrize) ? result.specialPrize.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.firstPrize) ? result.firstPrize.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.secondPrize) ? result.secondPrize.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.threePrizes) ? result.threePrizes.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.fourPrizes) ? result.fourPrizes.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.fivePrizes) ? result.fivePrizes.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.sixPrizes) ? result.sixPrizes.filter(num => /^\d+$/.test(num)) : []),
            ...(Array.isArray(result.sevenPrizes) ? result.sevenPrizes.filter(num => /^\d+$/.test(num)) : []),
        ];
    }, []).map(num => num ? num.slice(-2) : '').filter(num => num && /^\d{2}$/.test(num));

    const ganNumbers = Array.from({ length: 100 }, (_, i) => i.toString().padStart(2, '0'))
        .filter(num => !allNumbers.includes(num));

    try {
        await redisClient.setEx(cacheKey, 7200, JSON.stringify(ganNumbers));
    } catch (redisErr) {
        console.warn('Lỗi khi lưu Redis gan:', redisErr.message);
    }
    return ganNumbers;
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

// Pascal method (Modified to use more recent data and avoid repetition)
const applyPascal = async (results, diamondResult, pairResult, historicalPredictions) => {
    if (!results[0]) return '';
    const latestResult = results[0];
    const specialPrize = Array.isArray(latestResult.specialPrize) && latestResult.specialPrize[0] ? latestResult.specialPrize[0] : '';
    const firstPrize = Array.isArray(latestResult.firstPrize) && latestResult.firstPrize[0] ? latestResult.firstPrize[0] : '';
    if (!specialPrize || !firstPrize || !/^\d+$/.test(specialPrize) || !/^\d+$/.test(firstPrize)) {
        return '';
    }
    const secondLatestResult = results[1] || {};
    const secondSpecialPrize = Array.isArray(secondLatestResult.specialPrize) && secondLatestResult.specialPrize[0] ? secondLatestResult.specialPrize[0] : specialPrize;
    const input = ((parseInt(specialPrize.slice(-2)) + parseInt(secondSpecialPrize.slice(-2))) % 100).toString().padStart(2, '0') + firstPrize.slice(-2);
    let result = input.split('').map(Number);
    while (result.length > 2) {
        result = result.slice(0, -1).map((num, i) => (num + result[i + 1]) % 10);
    }
    let pascalResult = result.join('').padStart(2, '0');

    const frequencies = await calculateFrequencies(results, 'xsmb', results.length, await getRedisClient());
    const topNumbers = frequencies.slice(0, 5).map(item => item.number);

    // Avoid repetition with historical predictions
    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    if (historicalNumbers.includes(pascalResult) && topNumbers.length > 0) {
        pascalResult = topNumbers.find(num => !historicalNumbers.includes(num)) || pascalResult;
    }

    if (topNumbers.includes(pascalResult)) {
        return pascalResult;
    }
    return diamondResult || pairResult || topNumbers[0] || pascalResult;
};

// Diamond Shape method (Modified to use more recent data and avoid repetition)
const applyDiamondShape = async (results, numDays, redisClient, historicalPredictions) => {
    if (!results.length) return '';
    const recentResults = results.slice(0, 3);
    const lastTwoDigits = recentResults
        .reduce((acc, result) => {
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

    if (diamondResult) {
        const ganNumbers = await calculateGanNumbers(results, 'xsmb', numDays, redisClient);
        if (ganNumbers.includes(diamondResult)) {
            return '';
        }

        // Avoid repetition with historical predictions
        const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
        if (historicalNumbers.includes(diamondResult)) {
            const frequencies = await calculateFrequencies(results, 'xsmb', numDays, redisClient);
            const topNumbers = frequencies.slice(0, 5).map(item => item.number);
            diamondResult = topNumbers.find(num => !historicalNumbers.includes(num) && !ganNumbers.includes(num)) || '';
        }
    }
    return diamondResult || lastTwoDigits[0] || '';
};

// Frequency-based Pairs method (Modified to avoid repetition)
const applyFrequencyPairs = async (results, redisClient, historicalPredictions) => {
    if (!results.length) return '';
    const recentResults = results.slice(0, 5);
    const frequencies = await calculateFrequencies(recentResults, 'xsmb', recentResults.length, redisClient);
    if (frequencies.length === 0) return '';

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const topPair = frequencies.find(item => !historicalNumbers.includes(item.number)) || frequencies[0];
    return topPair ? topPair.number : '';
};

// Gan and Frequency Combination method
const applyGanFrequency = async (results, numDays, redisClient, historicalPredictions) => {
    if (!results.length) return '';
    const ganNumbers = await calculateGanNumbers(results, 'xsmb', numDays, redisClient);
    const frequencies = await calculateFrequencies(results, 'xsmb', numDays, redisClient);
    const ganThreshold = await calculateGanThreshold(results, numDays);
    const nearGanNumbers = ganNumbers.slice(0, Math.min(5, ganNumbers.length));
    const highFreqNumbers = frequencies.slice(0, 5).map(item => item.number);

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const candidate = nearGanNumbers.find(num => highFreqNumbers.includes(num) && !historicalNumbers.includes(num));
    return candidate || highFreqNumbers.find(num => !historicalNumbers.includes(num)) || highFreqNumbers[0] || '';
};

// Lô rơi method (Modified to avoid repetition)
const applyLoRoi = async (results, historicalPredictions) => {
    if (results.length < 2 || !results[0] || !results[1]) return '';

    const getLastTwoDigits = (result) => {
        if (!result) return [];
        return [
            ...(Array.isArray(result.specialPrize) ? result.specialPrize : []),
            ...(Array.isArray(result.firstPrize) ? result.firstPrize : []),
            ...(Array.isArray(result.secondPrize) ? result.secondPrize : []),
        ].map(prize => prize ? prize.slice(-2) : '').filter(prize => prize);
    };

    const lastTwoDigitsRecent = getLastTwoDigits(results[0]);
    const lastTwoDigitsPrevious = getLastTwoDigits(results[1]);

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const loRoi = lastTwoDigitsRecent.find(num => lastTwoDigitsPrevious.includes(num) && !historicalNumbers.includes(num));
    return loRoi || lastTwoDigitsRecent.find(num => !historicalNumbers.includes(num)) || '';
};

// Lô kép theo chu kỳ method
const calculateLoKepCycle = async (results, redisClient, historicalPredictions) => {
    if (!results.length) return '';
    const loKep = Array.from({ length: 10 }, (_, i) => `${i}${i}`);
    const allNumbers = results
        .reduce((acc, result) => {
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
            ];
        }, [])
        .map(num => num ? num.slice(-2) : '').filter(num => num);

    const cycleMap = {};
    loKep.forEach(kep => {
        let lastAppearance = -1;
        const gaps = [];
        for (let i = 0; i < results.length; i++) {
            if (allNumbers.includes(kep) && allNumbers.indexOf(kep) >= lastAppearance) {
                gaps.push(i - lastAppearance - 1);
                lastAppearance = i;
            }
        }
        cycleMap[kep] = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : results.length;
    });

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const sortedKep = Object.entries(cycleMap)
        .sort(([, cycleA], [, cycleB]) => cycleA - cycleB)
        .filter(([kep]) => !historicalNumbers.includes(kep));
    return sortedKep[0]?.[0] || loKep[Math.floor(Math.random() * loKep.length)];
};

// Biên độ tần suất method
const applyFrequencyRange = async (results, redisClient, historicalPredictions) => {
    if (!results.length) return '';
    const frequencies = await calculateFrequencies(results, 'xsmb', results.length, redisClient);
    const counts = frequencies.map(f => f.count);
    const avgCount = counts.reduce((sum, c) => sum + c, 0) / counts.length || 1;

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const midRange = frequencies
        .filter(f => Math.abs(f.count - avgCount) < avgCount * 0.3)
        .filter(f => !historicalNumbers.includes(f.number));
    return midRange.length > 0 ? midRange[0].number : frequencies.find(f => !historicalNumbers.includes(f.number))?.number || '';
};

// Chu kỳ số method
const applyNumberCycle = async (results, redisClient, historicalPredictions) => {
    if (!results.length) return '';
    const allNumbers = results
        .reduce((acc, result) => {
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
            ];
        }, [])
        .map(num => num ? num.slice(-2) : '').filter(num => num);

    const cycleMap = {};
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
        cycleMap[num] = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : results.length;
    }

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    const sortedCycles = Object.entries(cycleMap)
        .sort(([, cycleA], [, cycleB]) => cycleA - cycleB)
        .filter(([num]) => !historicalNumbers.includes(num));
    return sortedCycles[0]?.[0] || '';
};

// Tổng các chữ số
const applySumDigits = async (results, historicalPredictions) => {
    if (!results[0]) return '';
    const latestResult = results[0];
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
        totalSum = (totalSum + 1) % 100; // Adjust to avoid repetition
    }
    return totalSum.toString().padStart(2, '0');
};

// Đảo ngược
const applyReverse = async (results, historicalPredictions) => {
    if (!results[0]) return '';
    const latestResult = results[0];
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
const applyDistance = async (results, historicalPredictions) => {
    if (results.length < 2 || !results[0] || !results[1]) return '';
    const latestSpecial = results[0].specialPrize?.[0] ? parseInt(results[0].specialPrize[0].slice(-2)) : null;
    const prevSpecial = results[1].specialPrize?.[0] ? parseInt(results[1].specialPrize[0].slice(-2)) : null;
    if (!latestSpecial || !prevSpecial) return '';
    let distance = Math.abs(latestSpecial - prevSpecial) % 100;

    const historicalNumbers = historicalPredictions.flatMap(h => h.predictions.filter(p => p.number).map(p => p.number));
    if (historicalNumbers.includes(distance.toString().padStart(2, '0'))) {
        distance = (distance + 1) % 100;
    }
    return distance.toString().padStart(2, '0');
};

// Recent Trend Analysis (Modified to avoid repetition)
const applyRecentTrend = async (results, redisClient, historicalPredictions) => {
    if (results.length < 3) return '';
    const recentResults = results.slice(0, 3);
    const frequencies = await calculateFrequencies(recentResults, 'xsmb', recentResults.length, redisClient);
    const topRecentNumbers = frequencies.slice(0, 3).map(item => item.number);

    const numberTrends = {};
    for (let i = 0; i < recentResults.length; i++) {
        const dayNumbers = recentResults[i]
            ? [
                ...(Array.isArray(recentResults[i].specialPrize) ? recentResults[i].specialPrize : []),
                ...(Array.isArray(recentResults[i].firstPrize) ? recentResults[i].firstPrize : []),
                ...(Array.isArray(recentResults[i].secondPrize) ? recentResults[i].secondPrize : []),
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
const calculateHitRates = async (results, predictions, redisClient) => {
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

// Combine predictions (Modified to avoid repetition)
const combinePredictions = async (predictions, results, redisClient, historicalPredictions) => {
    const hitRates = await calculateHitRates(results, predictions, redisClient);
    const scoreMap = {};
    predictions.forEach(prediction => {
        if (prediction.number) {
            scoreMap[prediction.number] = (scoreMap[prediction.number] || 0) + hitRates[prediction.method];
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

// Fetch historical predictions (10 days, including today)
// Fetch historical predictions (10 days, excluding today if before result time)
const getHistoricalPredictions = async (targetDate, numDays, redisClient) => {
    const history = [];
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    const startOfPeriod = new Date(endOfDay);
    startOfPeriod.setDate(startOfPeriod.getDate() - numDays + 1);
    startOfPeriod.setHours(0, 0, 0, 0);

    const results = await XSMB.find({
        drawDate: { $gte: startOfPeriod, $lte: endOfDay },
        station: 'xsmb',
    })
        .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes')
        .sort({ drawDate: -1 })
        .lean();

    const currentTime = new Date();
    const isBeforeResultTime = currentTime.getHours() < 18 || (currentTime.getHours() === 18 && currentTime.getMinutes() < 40);
    const today = formatDate(currentTime);

    for (let i = 0; i < Math.min(numDays, 10); i++) {
        const pastDate = new Date(targetDate);
        pastDate.setDate(pastDate.getDate() - i);
        const formattedPastDate = formatDate(pastDate);

        // Bỏ qua ngày hiện tại nếu chưa có kết quả
        if (formattedPastDate === today && isBeforeResultTime) {
            continue;
        }

        const cacheKey = `bachthu:predict:${formattedPastDate}:days:${numDays}:for:${formattedPastDate}`;

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
            pastEndOfDay.setDate(pastEndOfDay.getDate() - 1); // Chỉ lấy dữ liệu đến ngày trước ngày dự đoán
            pastEndOfDay.setHours(23, 59, 59, 999);
            const pastStartOfPeriod = new Date(pastEndOfDay);
            pastStartOfPeriod.setDate(pastStartOfPeriod.getDate() - numDays + 1);
            pastStartOfPeriod.setHours(0, 0, 0, 0);

            const pastResults = await XSMB.find({
                drawDate: { $gte: pastStartOfPeriod, $lte: pastEndOfDay },
                station: 'xsmb',
            })
                .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes')
                .sort({ drawDate: -1 })
                .lean();

            if (pastResults.length === 0) continue;

            const validPastResults = pastResults.filter(result =>
                result &&
                (Array.isArray(result.specialPrize) ||
                    Array.isArray(result.firstPrize) ||
                    Array.isArray(result.secondPrize) ||
                    Array.isArray(result.threePrizes) ||
                    Array.isArray(result.fourPrizes) ||
                    Array.isArray(result.fivePrizes) ||
                    Array.isArray(result.sixPrizes) ||
                    Array.isArray(result.sevenPrizes))
            );

            if (validPastResults.length === 0) continue;

            const pastHistory = await getHistoricalPredictions(new Date(pastDate.getTime() - 24 * 60 * 60 * 1000), numDays, redisClient);

            const diamondResult = await applyDiamondShape(validPastResults, numDays, redisClient, pastHistory);
            const pairResult = await applyFrequencyPairs(validPastResults, redisClient, pastHistory);
            const pascalResult = await applyPascal(validPastResults, diamondResult, pairResult, pastHistory);
            const ganFreqResult = await applyGanFrequency(validPastResults, numDays, redisClient, pastHistory);
            const loRoiResult = await applyLoRoi(validPastResults, pastHistory);
            const loKepResult = await calculateLoKepCycle(validPastResults, redisClient, pastHistory);
            const freqRangeResult = await applyFrequencyRange(validPastResults, redisClient, pastHistory);
            const numberCycleResult = await applyNumberCycle(validPastResults, redisClient, pastHistory);
            const sumDigitsResult = await applySumDigits(validPastResults, pastHistory);
            const reverseResult = await applyReverse(validPastResults, pastHistory);
            const distanceResult = await applyDistance(validPastResults, pastHistory);
            const recentTrendResult = await applyRecentTrend(validPastResults, redisClient, pastHistory);

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

            const { topNumber, additionalSuggestions } = await combinePredictions(predictions, validPastResults, redisClient, pastHistory);

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

        const actualResult = results.find(r => formatDate(r.drawDate) === formattedPastDate);
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
            ].map(num => num ? num.slice(-2) : '').filter(num => num)
            : [];

        const predictedNumbers = pastPrediction.predictions
            .filter(p => p.number)
            .map(p => p.number);
        const matchingNumbers = actualNumbers.filter(num => predictedNumbers.includes(num));

        const isHit = matchingNumbers.length > 0;

        history.push({
            date: formattedPastDate,
            predictions: pastPrediction.predictions,
            combinedPrediction: pastPrediction.combinedPrediction,
            actualNumbers: matchingNumbers,
            isHit,
        });
    }

    return history;
};

// Fetch bạch thủ prediction
const getBachThuMB = async (req, res) => {
    try {
        const numDays = 14; // Sử dụng 14 ngày để đảm bảo đủ dữ liệu cho tần suất
        const currentTime = new Date();
        const targetDate = new Date();
        const today = formatDate(targetDate);
        const lastUpdateKey = `lastUpdate:${today}`;
        const redisClient = await getRedisClient();

        // Kiểm tra và cập nhật dữ liệu nếu sau 18h35
        let lastUpdate = await redisClient.get(lastUpdateKey);
        const thresholdTime = new Date(currentTime);
        thresholdTime.setHours(18, 40, 0, 0);
        const isAfterResultTime = currentTime > thresholdTime;
        if (isAfterResultTime && !lastUpdate) {
            const keys = await redisClient.keys('bachthu:predict:*');
            const freqKeys = await redisClient.keys('frequencies:*');
            const ganKeys = await redisClient.keys('gan:*');
            if (keys.length > 0) await redisClient.del(keys);
            if (freqKeys.length > 0) await redisClient.del(freqKeys);
            if (ganKeys.length > 0) await redisClient.del(ganKeys);
            await redisClient.setEx(lastUpdateKey, 86400, 'true');
            console.log(`Dữ liệu đã được cập nhật vào ${currentTime} cho ngày ${today}`);
        }

        const isCurrentDate = formatDate(targetDate) === formatDate(new Date());
        let predictionDate = isCurrentDate && isAfterResultTime
            ? formatDate(new Date(currentTime.getTime() + 24 * 60 * 60 * 1000))
            : formatDate(currentTime);

        const formattedTargetDate = formatDate(targetDate);
        const cacheKey = `bachthu:predict:${formattedTargetDate}:days:${numDays}:for:${predictionDate}`;

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

        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        const startOfPeriod = new Date(endOfDay);
        startOfPeriod.setDate(startOfPeriod.getDate() - numDays + 1);
        startOfPeriod.setHours(0, 0, 0, 0);

        const results = await XSMB.find({
            drawDate: { $gte: startOfPeriod, $lte: endOfDay },
            station: 'xsmb',
        })
            .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes')
            .sort({ drawDate: -1 })
            .lean();

        if (results.length === 0) {
            const extendedStart = new Date(endOfDay);
            extendedStart.setDate(extendedStart.getDate() - 30);
            const extendedResults = await XSMB.find({
                drawDate: { $gte: extendedStart, $lte: endOfDay },
                station: 'xsmb',
            })
                .select('drawDate specialPrize firstPrize secondPrize threePrizes fourPrizes fivePrizes sixPrizes sevenPrizes')
                .sort({ drawDate: -1 })
                .lean();

            if (extendedResults.length === 0) {
                return res.status(404).json({
                    error: `Không tìm thấy dữ liệu xổ số trong ${numDays} ngày hoặc 30 ngày trước ngày ${formattedTargetDate}.`,
                    suggestedDate: formatDate(new Date(targetDate.setDate(targetDate.getDate() - 1))),
                });
            }
            results.push(...extendedResults);
        }

        const validResults = results.filter(result =>
            result &&
            (Array.isArray(result.specialPrize) ||
                Array.isArray(result.firstPrize) ||
                Array.isArray(result.secondPrize) ||
                Array.isArray(result.threePrizes) ||
                Array.isArray(result.fourPrizes) ||
                Array.isArray(result.fivePrizes) ||
                Array.isArray(result.sixPrizes) ||
                Array.isArray(result.sevenPrizes))
        );

        if (validResults.length === 0) {
            return res.status(404).json({
                error: `Dữ liệu xổ số không hợp lệ trong ${numDays} ngày trước ngày ${formattedTargetDate}.`,
                suggestedDate: formatDate(new Date(targetDate.setDate(targetDate.getDate() - 1))),
            });
        }

        const latestDate = new Date(validResults[0].drawDate);
        const earliestDate = new Date(validResults[validResults.length - 1].drawDate);

        const history = await getHistoricalPredictions(targetDate, numDays, redisClient);

        const diamondResult = await applyDiamondShape(validResults, numDays, redisClient, history);
        const pairResult = await applyFrequencyPairs(validResults, redisClient, history);
        const pascalResult = await applyPascal(validResults, diamondResult, pairResult, history);
        const ganFreqResult = await applyGanFrequency(validResults, numDays, redisClient, history);
        const loRoiResult = await applyLoRoi(validResults, history);
        const loKepResult = await calculateLoKepCycle(validResults, redisClient, history);
        const freqRangeResult = await applyFrequencyRange(validResults, redisClient, history);
        const numberCycleResult = await applyNumberCycle(validResults, redisClient, history);
        const sumDigitsResult = await applySumDigits(validResults, history);
        const reverseResult = await applyReverse(validResults, history);
        const distanceResult = await applyDistance(validResults, history);
        const recentTrendResult = await applyRecentTrend(validResults, redisClient, history);

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

        const { topNumber, additionalSuggestions } = await combinePredictions(predictions, validResults, redisClient, history);

        const getLastTwoDigits = (number) => {
            if (!number || typeof number !== 'string' || !/^\d+$/.test(number)) return null;
            const str = number.toString();
            return str.length >= 2 ? parseInt(str.slice(-2)) : parseInt(str);
        };

        const allPrizes = validResults.reduce((acc, result) => {
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
            ];
        }, []);

        const numbers = [...new Set(
            allPrizes
                .map(prize => getLastTwoDigits(prize))
                .filter(num => num !== null && num >= 0 && num <= 99)
        )].map(num => num.toString().padStart(2, '0'));

        // Lấy Top 10 số xuất hiện từ 3 lần trở lên, sử dụng dữ liệu 14 ngày
        let filteredFrequencies = (await calculateFrequencies(validResults, 'xsmb', 10, redisClient))
            .filter(freq => freq.count >= 3)
            .sort((a, b) => b.count - a.count);

        if (filteredFrequencies.length < 10) {
            const additionalFrequencies = (await calculateFrequencies(validResults, 'xsmb', 10, redisClient))
                .filter(freq => freq.count === 2 && !filteredFrequencies.some(f => f.number === freq.number))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10 - filteredFrequencies.length);
            filteredFrequencies = [...filteredFrequencies, ...additionalFrequencies];
        }

        filteredFrequencies = filteredFrequencies.slice(0, 10);
        const uniqueBachThuLo = [...new Set(filteredFrequencies.map(freq => freq.number))].slice(0, 10);

        const response = {
            predictionDate,
            dataRange: {
                from: formatDate(earliestDate),
                to: formatDate(latestDate),
                days: numDays,
                actualDays: validResults.length,
            },
            predictions,
            combinedPrediction: sanitizeResult(topNumber),
            additionalSuggestions: additionalSuggestions.map(sanitizeResult),
            history,
            totalNumbers: numbers.length,
            numbers,
            frequencies: filteredFrequencies,
            bachThuLo: uniqueBachThuLo,
            metadata: {
                predictionFor: predictionDate,
                dataFrom: formatDate(earliestDate),
                dataTo: formatDate(latestDate),
                totalDraws: validResults.length,
                specialPrize: sanitizeResult(validResults[0] && Array.isArray(validResults[0].specialPrize) ? validResults[0].specialPrize[0] || '' : ''),
                firstPrize: sanitizeResult(validResults[0] && Array.isArray(validResults[0].firstPrize) ? validResults[0].firstPrize[0] || '' : ''),
                message: validResults.length < numDays
                    ? `Dự đoán cho ngày ${predictionDate} dựa trên dữ liệu từ ${formatDate(earliestDate)} đến ${formatDate(latestDate)} (chỉ tìm thấy ${validResults.length} ngày cho tần suất Top 10).`
                    : `Dự đoán cho ngày ${predictionDate} dựa trên dữ liệu từ ${formatDate(earliestDate)} đến ${formatDate(latestDate)}.`,
                frequencyDays: 14, // Thêm để thông báo cho frontend
            },
        };

        try {
            await redisClient.setEx(cacheKey, isCurrentDate ? 3600 : 7200, JSON.stringify(response));
            console.log(`Đã cache dữ liệu: ${cacheKey}`);
        } catch (redisErr) {
            console.warn('Lỗi khi lưu vào Redis:', redisErr.message);
        }

        res.status(200).json(response);
    } catch (error) {
        console.error('Lỗi trong getBachThuMB:', error.message);
        if (error.message.includes('Không tìm thấy dữ liệu') || error.message.includes('Dữ liệu xổ số không hợp lệ')) {
            res.status(404).json({ error: error.message, suggestedDate: formatDate(new Date()) });
        } else {
            res.status(500).json({ error: `Lỗi máy chủ nội bộ: ${error.message}` });
        }
    }
};

module.exports = {
    getBachThuMB,
};