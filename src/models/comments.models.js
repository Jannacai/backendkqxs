const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    content: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    parentComment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    depth: { type: Number, default: 0 },
    taggedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Người được tag
    createdAt: { type: Date, default: Date.now },
});

commentSchema.virtual('childComments', {
    ref: 'Comment',
    localField: '_id',
    foreignField: 'parentComment',
});

commentSchema.set('toObject', { virtuals: true });
commentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Comment', commentSchema);