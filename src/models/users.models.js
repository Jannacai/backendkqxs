const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const refreshTokenSchema = new mongoose.Schema({
    token: { type: String, required: true },
    deviceInfo: { type: String, required: true },
    expiresAt: { type: Date, required: true },
});

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true }, // Thêm trường email
    fullname: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER' },
    refreshTokens: [refreshTokenSchema],
    createdAt: { type: Date, default: Date.now },
});

userSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        console.log('Hashing password for user:', this.username);
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

userSchema.methods.comparePassword = async function (password) {
    console.log('Comparing password for user:', this.username);
    return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);