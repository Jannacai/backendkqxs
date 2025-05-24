// models/XSMN.js
const mongoose = require('mongoose');

const xsmnSchema = new mongoose.Schema({
    drawDate: { type: Date, required: true },
    dayOfWeek: { type: String },
    tentinh: { type: String, required: true },
    tinh: { type: String, required: true },
    slug: { type: String },
    year: { type: Number },
    month: { type: Number },
    eightPrizes: { type: [String] },
    sevenPrizes: { type: [String] },
    sixPrizes: { type: [String] },
    fivePrizes: { type: [String] },
    fourPrizes: { type: [String] },
    threePrizes: { type: [String] },
    secondPrize: { type: [String] },
    firstPrize: { type: [String] },
    specialPrize: { type: [String] },
    station: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
}, {
    indexes: [
        { key: { drawDate: 1, station: 1, tentinh: 1 }, unique: true },
        { key: { drawDate: -1 } },
        { key: { tentinh: 1 } },
    ],
});

module.exports = mongoose.model('XSMN', xsmnSchema);