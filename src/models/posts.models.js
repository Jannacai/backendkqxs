// const mongoose = require("mongoose");

// const VALID_CATEGORIES = ["Tin hot", "Thể thao", "Đời sống", "Giải trí"];

// const createSlug = (title) => {
//     const vietnameseMap = {
//         "à": "a", "á": "a", "ả": "a", "ã": "a", "ạ": "a",
//         "ă": "a", "ằ": "a", "ắ": "a", "ẳ": "a", "ẵ": "a", "ặ": "a",
//         "â": "a", "â": "a", "ấ": "a", "ẩ": "a", "ẫ": "a", "ậ": "a",
//         "è": "e", "é": "e", "ẻ": "e", "ẽ": "e", "ẹ": "e",
//         "ê": "e", "ê": "e", "ế": "e", "ể": "e", "ễ": "e", "ệ": "e",
//         "ì": "i", "í": "i", "í": "i", "ĩ": "i", "ị": "i",
//         "ò": "o", "ó": "o", "ỏ": "o", "õ": "o", "ọ": "o",
//         "ô": "o", "ô": "o", "ố": "o", "ổ": "o", "ỗ": "o", "ộ": "o",
//         "ơ": "o", "ở": "o", "ớ": "o", "ở": "o", "ỡ": "o", "o": "o",
//         "ù": "u", "ú": "u", "ủ": "u", "ũ": "u", "ụ": "u",
//         "ư": "u", "ử": "u", "ứ": "u", "ử": "u", "ữ": "u", "ự": "u",
//         "ỳ": "y", "ý": "y", "ỷ": "y", "ỹ": "y", "ỵ": "y",
//         "đ": "d",
//         "À": "A", "Á": "A", "Ả": "A", "Ã": "A", "Ạ": "A",
//         "Ă": "A", "Ằ": "A", "Ắ": "A", "Ẳ": "A", "Ẵ": "A", "Ặ": "A",
//         "Â": "A", "Ầ": "A", "Ấ": "A", "Ẩ": "A", "Ẫ": "A", "Ậ": "A",
//         "È": "E", "É": "E", "Ẻ": "E", "Ẽ": "E", "Ẹ": "E",
//         "Ê": "E", "Ề": "E", "Ế": "E", "Ể": "E", "Ễ": "E", "Ệ": "E",
//         "Ì": "I", "É": "I", "Ỉ": "I", "É": "I", "Ị": "I",
//         "Ò": "O", "Ó": "O", "Ỏ": "O", "Ỗ": "O", "Ọ": "O",
//         "Ô": "O", "Ồ": "O", "Ố": "O", "Ổ": "O", "Ỗ": "O", "Ộ": "O",
//         "Ơ": "O", "Ờ": "O", "Ớ": "O", "Ở": "O", "Ỡ": "O", "Ợ": "O",
//         "Ù": "U", "Ú": "U", "Ủ": "U", "Ũ": "U", "Ụ": "U",
//         "Ư": "U", "Ừ": "U", "Ứ": "U", "Ử": "U", "Ữ": "U", "Ự": "U",
//         "Ỳ": "Y", "Ý": "Y", "Ỷ": "Y", "Ỹ": "Y", "Ỵ": "Y",
//         "Đ": "D"
//     };

//     return title
//         .toLowerCase()
//         .replace(/[àáảãạăằắẳẵặâầấẩẫậ]/g, (match) => vietnameseMap[match] || match)
//         .replace(/[èéèẽẹêềếểễ]/g, (match) => vietnameseMap[match] || match)
//         .replace(/[ìííĩí]/g, (match) => vietnameseMap[match] || match)
//         .replace(/[òóỏõọôôốổỗộơờớởỡ]/g, (match) => vietnameseMap[match] || match)
//         .replace(/[ùúủũụưừứửữ]/g, (match) => vietnameseMap[match] || match)
//         .replace(/[ỳýýỹỵ]/g, (match) => vietnameseMap[match] || match)
//         .replace(/đ/gi, "d")
//         .replace(/[^a-z0-9\s-]/g, "")
//         .replace(/\s+/g, "-")
//         .replace(/-+/g, "-")
//         .trim();
// };

// const postSchema = new mongoose.Schema({
//     title: { type: String, required: true },
//     mainContents: [{
//         h2: { type: String },
//         description: { type: String },
//         img: { type: String },
//         caption: { type: String },
//         isImageFirst: { type: Boolean, default: false },
//     }],
//     author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
//     createdAt: { type: Date, default: Date.now },
//     category: {
//         type: [String],
//         required: true,
//         enum: VALID_CATEGORIES,
//         default: ["Tin hot"]
//     },
//     slug: { type: String, required: true, unique: true },
//     contentOrder: [{
//         type: { type: String, enum: ["mainContent"], required: true },
//         index: { type: Number, default: 0 },
//     }],
// });

// postSchema.pre("validate", function (next) {
//     if (this.isModified("title") || !this.slug) {
//         this.slug = createSlug(this.title);
//     }
//     next();
// });

// postSchema.pre("save", async function (next) {
//     if (this.isModified("slug")) {
//         let slug = this.slug;
//         let newSlug = slug; // Khởi tạo newSlug
//         let count = 1;
//         const maxAttempts = 10;
//         while (await this.constructor.findOne({ slug: newSlug, _id: { $ne: this._id } })) {
//             if (count > maxAttempts) {
//                 return next(new Error("Không thể tạo slug duy nhất"));
//             }
//             newSlug = `${slug}-${count}`;
//             count++;
//         }
//         this.slug = newSlug;
//     }
//     next();
// });

// postSchema.index({ category: 1, createdAt: -1 });

// module.exports = mongoose.model("Post", postSchema);
// module.exports.VALID_CATEGORIES = VALID_CATEGORIES;