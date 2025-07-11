// const express = require("express");
// const router = express.Router();
// const jwt = require("jsonwebtoken");
// const Post = require("../../models/posts.models");
// const { VALID_CATEGORIES } = require("../../models/posts.models");
// const redis = require("redis");
// const rateLimit = require("express-rate-limit");
// const cloudinary = require("cloudinary").v2;
// const multer = require("multer");

// // Cấu hình Cloudinary
// cloudinary.config({
//     cloud_name: "db15lvbrw",
//     api_key: "685414381137448",
//     api_secret: "6CNRrgEZQNt4GFggzkt0G5A8ePY",
// });
// console.log('Cloudinary Config:', {
//     cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//     api_key: process.env.CLOUDINARY_API_KEY ? 'Set' : 'Not set',
//     api_secret: process.env.CLOUDINARY_API_SECRET ? 'Set' : 'Not set',
// });

// // Cấu hình Multer để xử lý file upload
// const storage = multer.memoryStorage();
// const upload = multer({
//     storage,
//     limits: { fileSize: 5 * 1024 * 1024 }, // Giới hạn 5MB
//     fileFilter: (req, file, cb) => {
//         const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
//         if (allowedTypes.includes(file.mimetype)) {
//             cb(null, true);
//         } else {
//             cb(new Error('Chỉ cho phép các định dạng ảnh: jpg, jpeg, png, gif, webp'), false);
//         }
//     },
// });

// const redisClient = redis.createClient({
//     url: process.env.REDIS_URL || "redis://localhost:6379",
// });
// redisClient.connect().catch((err) => console.error("Lỗi kết nối Redis:", err));

// const apiLimiter = rateLimit({
//     windowMs: 60 * 1000,
//     max: 200,
//     message: "Quá nhiều yêu cầu, vui lòng thử lại sau.",
//     headers: true,
// });

// const authenticate = (req, res, next) => {
//     const token = req.headers.authorization?.split(" ")[1];
//     if (!token) {
//         return res.status(401).json({ error: "Unauthorized" });
//     }
//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
//         req.user = decoded;
//         next();
//     } catch (error) {
//         console.error("Token verification error:", error.message);
//         return res.status(401).json({ error: "Invalid token" });
//     }
// };

// const restrictToAdmin = (req, res, next) => {
//     if (req.user.role !== "ADMIN") {
//         return res.status(403).json({ error: "Only admins can perform this action" });
//     }
//     next();
// };



// router.post("/", authenticate, restrictToAdmin, async (req, res) => {
//     const { title, mainContents, category, contentOrder } = req.body;

//     if (!title) {
//         return res.status(400).json({ error: "Title is required" });
//     }

//     if (mainContents) {
//         if (!Array.isArray(mainContents)) {
//             return res.status(400).json({ error: "mainContents must be an array" });
//         }
//         for (const content of mainContents) {
//             if (content.h2 && (content.h2.length < 5 || content.h2.length > 200)) {
//                 return res.status(400).json({ error: "h2 must be between 5 and 200 characters" });
//             }
//             if (content.description && content.description.length < 20) {
//                 return res.status(400).json({ error: "description must be at least 20 characters" });
//             }
//             if (content.caption && content.caption.length > 200) {
//                 return res.status(400).json({ error: "caption must be at most 200 characters" });
//             }
//             if (content.img && !/^(https?:\/\/)/.test(content.img)) {
//                 return res.status(400).json({ error: "Image URL must be a valid URL" });
//             }
//         }
//     }

//     if (category) {
//         if (!Array.isArray(category) || category.length === 0 || !category.every(cat => VALID_CATEGORIES.includes(cat))) {
//             return res.status(400).json({ error: "Invalid category" });
//         }
//     }

//     try {
//         const post = new Post({
//             title,
//             mainContents: mainContents || [],
//             author: req.user.userId,
//             category: category || ["Tin hot"],
//             contentOrder: contentOrder || [],
//         });
//         await post.save();

//         const cacheKeysToClear = new Set([`post:${post._id}`]);
//         for (const cat of category || ["Tin hot"]) {
//             cacheKeysToClear.add(`posts:recent:page:1:limit:15:category:${cat || 'all'}`);
//         }
//         await redisClient.del([...cacheKeysToClear]);

//         res.status(201).json(post);
//     } catch (error) {
//         console.error("Error saving post:", error.message);
//         if (error.name === "ValidationError") {
//             return res.status(400).json({ error: "Invalid data", details: error.errors });
//         }
//         return res.status(500).json({ error: "Failed to save post", details: error.message });
//     }
// });
// // Endpoint để tải file lên Cloudinary
// router.post('/upload-to-cloudinary', authenticate, restrictToAdmin, upload.single('file'), async (req, res) => {
//     try {
//         if (!req.file) {
//             return res.status(400).json({ error: 'No file uploaded' });
//         }

//         console.log('Uploading file to Cloudinary:', {
//             originalname: req.file.originalname,
//             mimetype: req.file.mimetype,
//             size: req.file.size,
//         });

//         const bufferStream = require('stream').PassThrough();
//         bufferStream.end(req.file.buffer);

//         const result = await new Promise((resolve, reject) => {
//             const uploadStream = cloudinary.uploader.upload_stream(
//                 {
//                     folder: 'posts',
//                     public_id: `${Date.now()}_${req.file.originalname.split('.')[0]}`,
//                     resource_type: 'image',
//                     transformation: [{ width: 1200, quality: 'auto', fetch_format: 'auto' }],
//                 },
//                 (error, result) => {
//                     if (error) reject(error);
//                     else resolve(result);
//                 }
//             );
//             bufferStream.pipe(uploadStream);
//         });

//         console.log('Cloudinary upload result:', {
//             secure_url: result.secure_url,
//             public_id: result.public_id,
//         });

//         res.status(200).json({ url: result.secure_url });
//     } catch (error) {
//         console.error('Error uploading to Cloudinary:', error);
//         res.status(500).json({ error: 'Failed to upload to Cloudinary', details: error.message });
//     }
// });
// router.get("/categories", apiLimiter, async (req, res) => {
//     try {
//         res.status(200).json({ categories: VALID_CATEGORIES });
//     } catch (error) {
//         console.error("Error fetching categories:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// router.get("/", apiLimiter, async (req, res) => {
//     try {
//         const page = parseInt(req.query.page) || 1;
//         const limit = Math.min(parseInt(req.query.limit) || 15, 15);
//         const skip = (page - 1) * limit;
//         const category = req.query.category || null;

//         const cacheKey = `posts:recent:page:${page}:limit:${limit}:category:${category || 'all'}`;
//         const cached = await redisClient.get(cacheKey);

//         if (cached) {
//             res.set('Cache-Control', 'no-store');
//             return res.status(200).json(JSON.parse(cached));
//         }

//         const now = new Date();
//         const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
//         let query = category ? { category: { $in: [category] } } : {};
//         let posts = await Post.find(query)
//             .select("title mainContents createdAt category slug contentOrder")
//             .sort({ createdAt: -1 })
//             .skip(skip)
//             .limit(limit)
//             .lean();

//         const seenIds = new Set();
//         const uniquePosts = posts.filter(post => !seenIds.has(post._id) && seenIds.add(post._id));

//         const totalPosts = await Post.countDocuments(query);

//         const response = {
//             posts: uniquePosts,
//             totalPages: Math.ceil(totalPosts / limit),
//             currentPage: page,
//             hasMore: uniquePosts.length === limit && skip + limit < totalPosts,
//         };

//         await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
//         await redisClient.sAdd("cachedPostKeys", cacheKey);
//         res.set('Cache-Control', 'no-store');
//         res.status(200).json(response);
//     } catch (error) {
//         console.error("Error in GET /api/posts:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// router.get("/:identifier", apiLimiter, async (req, res) => {
//     try {
//         const { identifier } = req.params;
//         const cacheKey = `post:${identifier}`;
//         const cached = await redisClient.get(cacheKey);

//         if (cached) {
//             res.set('Cache-Control', 'no-store');
//             return res.status(200).json(JSON.parse(cached));
//         }

//         const isMongoId = /^[0-9a-fA-F]{24}$/.test(identifier);
//         const query = isMongoId ? { _id: identifier } : { slug: identifier };

//         const post = await Post.findOne(query)
//             .select("title mainContents createdAt category slug contentOrder")
//             .lean();
//         if (!post) {
//             return res.status(404).json({ error: "Post not found" });
//         }

//         await redisClient.setEx(cacheKey, 7200, JSON.stringify(post));
//         await redisClient.sAdd("cachedPostKeys", cacheKey);
//         res.set('Cache-Control', 'no-store');
//         res.status(200).json(post);
//     } catch (error) {
//         console.error("Error fetching post:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// router.get("/combined/:identifier", apiLimiter, async (req, res) => {
//     try {
//         const { identifier } = req.params;
//         const cacheKey = `combined:${identifier}`;
//         const cached = await redisClient.get(cacheKey);

//         if (cached) {
//             res.set('Cache-Control', 'no-store');
//             return res.status(200).json(JSON.parse(cached));
//         }

//         const isMongoId = /^[0-9a-fA-F]{24}$/.test(identifier);
//         const query = isMongoId ? { _id: identifier } : { slug: identifier };

//         const post = await Post.findOne(query)
//             .select("title mainContents createdAt category slug contentOrder")
//             .lean();
//         if (!post) {
//             return res.status(404).json({ error: "Post not found" });
//         }

//         let relatedQuery = {
//             category: { $in: post.category },
//             _id: { $ne: post._id }
//         };
//         let related = await Post.find(relatedQuery)
//             .select("title mainContents createdAt category slug contentOrder")
//             .sort({ createdAt: -1 })
//             .limit(15)
//             .lean();

//         let footballQuery = {
//             category: { $in: ["Thể thao"] },
//             _id: { $ne: post._id }
//         };
//         let football = await Post.find(footballQuery)
//             .select("title mainContents createdAt category slug contentOrder")
//             .sort({ createdAt: -1 })
//             .limit(15)
//             .lean();

//         const response = { post, related, football };
//         await redisClient.setEx(cacheKey, 7200, JSON.stringify(response));
//         await redisClient.sAdd("cachedPostKeys", cacheKey);
//         res.set('Cache-Control', 'no-store');
//         res.status(200).json(response);
//     } catch (error) {
//         console.error("Error fetching combined post data:", error.message);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// });

// module.exports = router;