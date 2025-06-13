const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    content: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
    parentComment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    depth: { type: Number, default: 0 },
    taggedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
    childComments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: [] }], // Mảng thực
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

commentSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Comment', commentSchema);