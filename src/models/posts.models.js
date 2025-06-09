const mongoose = require('mongoose');

// Danh sách danh mục tập trung, dễ dàng mở rộng
const VALID_CATEGORIES = ['Thể thao', 'Đời sống', 'Giải trí', 'Tin hot'];

// Hàm chuyển đổi tiêu đề thành slug không dấu
const createSlug = (title) => {
    const vietnameseMap = {
        'à': 'a', 'á': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
        'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
        'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
        'è': 'e', 'é': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
        'ê': 'e', 'ề': 'e', 'ế': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
        'ì': 'i', 'í': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
        'ò': 'o', 'ó': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
        'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
        'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
        'ù': 'u', 'ú': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
        'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
        'ỳ': 'y', 'ý': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y',
        'đ': 'd',
        'À': 'A', 'Á': 'A', 'Ả': 'A', 'Ã': 'A', 'Ạ': 'A',
        'Ă': 'A', 'Ằ': 'A', 'Ắ': 'A', 'Ẳ': 'A', 'Ẵ': 'A', 'Ặ': 'A',
        'Â': 'A', 'Ầ': 'A', 'Ấ': 'A', 'Ẩ': 'A', 'Ẫ': 'A', 'Ậ': 'A',
        'È': 'E', 'É': 'E', 'Ẻ': 'E', 'Ẽ': 'E', 'Ẹ': 'E',
        'Ê': 'E', 'Ề': 'E', 'Ế': 'E', 'Ể': 'E', 'Ễ': 'E', 'Ệ': 'E',
        'Ì': 'I', 'Í': 'I', 'Ỉ': 'I', 'Ĩ': 'I', 'Ị': 'I',
        'Ò': 'O', 'Ó': 'O', 'Ỏ': 'O', 'Ổ': 'O', 'Ọ': 'O',
        'Ô': 'O', 'Ồ': 'O', 'Ố': 'O', 'Ổ': 'O', 'Ỗ': 'O', 'Ộ': 'O',
        'Ơ': 'O', 'Ờ': 'O', 'Ớ': 'O', 'Ở': 'O', 'Ỡ': 'O', 'Ợ': 'O',
        'Ù': 'U', 'Ú': 'U', 'Ủ': 'U', 'Ũ': 'U', 'Ụ': 'U',
        'Ư': 'U', 'Ừ': 'U', 'Ứ': 'U', 'Ử': 'U', 'Ữ': 'U', 'Ự': 'U',
        'Ỳ': 'Y', 'Ý': 'Y', 'Ỷ': 'Y', 'Ỹ': 'Y', 'Ỵ': 'Y',
        'Đ': 'D'
    };

    return title
        .toLowerCase()
        .replace(/[àáảãạăằắẳẵặâầấẩẫậ]/g, (match) => vietnameseMap[match] || match)
        .replace(/[èéẻẽẹêềếểễệ]/g, (match) => vietnameseMap[match] || match)
        .replace(/[ìíỉĩị]/g, (match) => vietnameseMap[match] || match)
        .replace(/[òóỏõọôồốổỗộơờớởỡợ]/g, (match) => vietnameseMap[match] || match)
        .replace(/[ùúủũụưừứửữự]/g, (match) => vietnameseMap[match] || match)
        .replace(/[ỳýỷỹỵ]/g, (match) => vietnameseMap[match] || match)
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9\s-]/g, '') // Loại bỏ ký tự đặc biệt
        .replace(/\s+/g, '-') // Thay khoảng trắng bằng dấu gạch ngang
        .replace(/-+/g, '-') // Loại bỏ nhiều dấu gạch ngang liên tiếp
        .trim();
};

const postSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    img: { type: String },
    caption: { type: String },
    img2: { type: String },
    caption2: { type: String },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
    category: {
        type: [String], // Hỗ trợ mảng danh mục
        required: true,
        enum: VALID_CATEGORIES, // Sử dụng danh sách danh mục tập trung
        default: ['Thể thao']
    },
    slug: { type: String, required: true, unique: true }
});

// Tự động tạo slug trước khi validate
postSchema.pre('validate', function (next) {
    if (this.isModified('title') || !this.slug) {
        this.slug = createSlug(this.title);
    }
    next();
});

// Kiểm tra và xử lý slug trùng lặp trước khi lưu
postSchema.pre('save', async function (next) {
    if (this.isModified('slug')) {
        let slug = this.slug;
        let count = 1;
        let newSlug = slug;
        while (await this.constructor.findOne({ slug: newSlug, _id: { $ne: this._id } })) {
            newSlug = `${slug}-${count}`;
            count++;
        }
        this.slug = newSlug;
    }
    next();
});

// Tạo index cho category và createdAt
postSchema.index({ category: 1, createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);
module.exports.VALID_CATEGORIES = VALID_CATEGORIES; // Xuất danh sách danh mục để sử dụng ở nơi khác