// models/Post.js
const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    // drawDate: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    img: { type: String },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'admin', },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Post', postSchema);