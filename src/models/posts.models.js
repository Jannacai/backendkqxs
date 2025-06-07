const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    img: { type: String },
    img2: { type: String }, // Thêm trường cho hình ảnh thứ hai
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    category: {
        type: String,
        required: true,
        enum: ['Thể thao', 'Đời sống'],
        default: 'Thể thao'
    }
});

// Tạo index cho category để tối ưu truy vấn
postSchema.index({ category: 1, createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);