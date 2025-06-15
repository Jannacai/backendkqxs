const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Post = require("../../models/posts.models");
const { VALID_CATEGORIES } = require("../../models/posts.models");
const redis = require("redis");
const rateLimit = require("express-rate-limit");
const { google } = require('googleapis');
const stream = require('stream');
const multer = require('multer');

// Cấu hình Multer để xử lý file upload
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Giới hạn 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ cho phép các định dạng ảnh: jpg, jpeg, png, gif, webp'), false);
        }
    },
});

const redisClient = redis.createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
});
redisClient.connect().catch((err) => console.error("Lỗi kết nối Redis:", err));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    message: "Quá nhiều yêu cầu, vui lòng thử lại sau.",
    headers: true,
});

const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error("Token verification error:", error.message);
        return res.status(401).json({ error: "Invalid token" });
    }
};

const restrictToAdmin = (req, res, next) => {
    if (req.user.role !== "ADMIN") {
        return res.status(403).json({ error: "Only admins can perform this action" });
    }
    next();
};

// Endpoint để tải file lên Google Drive
router.post('/upload-to-drive', authenticate, restrictToAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const credentialsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
        // console.log('Raw GOOGLE_CREDENTIALS_JSON:', credentialsRaw.substring(0, 200) + '...');

        const credentials = JSON.parse(credentialsRaw);
        // console.log('Parsed credentials:', credentials);

        const auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });
        const drive = google.drive({ version: 'v3', auth });

        const fileMetadata = {
            name: `${Date.now()}_${req.file.originalname}`,
            parents: ['1_vIBh_U62kLvPbvq7lKEwlv_VpRtxbQt'],
        };
        const media = {
            mimeType: req.file.mimetype,
            body: stream.PassThrough().end(req.file.buffer),
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            media,
            fields: 'id',
        });

        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        const publicUrl = `https://drive.google.com/thumbnail?id=${response.data.id}&sz=w1000`;

        res.status(200).json({ url: publicUrl });
    } catch (error) {
        console.error('Error uploading to Google Drive:', error);
        res.status(500).json({ error: 'Failed to upload to Google Drive', details: error.stack });
    }
});

router.post("/", authenticate, restrictToAdmin, async (req, res) => {
    const { title, mainContents, category, contentOrder } = req.body;

    if (!title) {
        return res.status(400).json({ error: "Title is required" });
    }

    if (mainContents) {
        if (!Array.isArray(mainContents)) {
            return res.status(400).json({ error: "mainContents must be an array" });
        }
        for (const content of mainContents) {
            if (content.h2 && (content.h2.length < 5 || content.h2.length > 200)) {
                return res.status(400).json({ error: "h2 must be between 5 and 200 characters" });
            }
            if (content.description && content.description.length < 20) {
                return res.status(400).json({ error: "description must be at least 20 characters" });
            }
            if (content.caption && content.caption.length > 200) {
                return res.status(400).json({ error: "caption must be at most 200 characters" });
            }
            if (content.img && !/^(https?:\/\/)/.test(content.img)) {
                return res.status(400).json({ error: "Image URL must be a valid URL" });
            }
        }
    }

    if (category) {
        if (!Array.isArray(category) || category.length === 0 || !category.every(cat => VALID_CATEGORIES.includes(cat))) {
            return res.status(400).json({ error: "Invalid category" });
        }
    }

    if (contentOrder) {
        if (!Array.isArray(contentOrder) || !contentOrder.every(item => item.type === "mainContent")) {
            return res.status(400).json({ error: "Invalid contentOrder" });
        }
    }

    try {
        const post = new Post({
            title,
            mainContents: mainContents || [],
            author: req.user.userId,
            category: category || ["Tin hot"],
            contentOrder: contentOrder || [],
        });
        await post.save();

        for (const cat of category || ["Tin hot"]) {
            const cacheKey = `posts:recent:page:1:limit:15:category:${cat || 'all'}`;
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                let cachedData = JSON.parse(cached);
                cachedData.posts = [post.toJSON(), ...cachedData.posts.filter(p => p._id.toString() !== post._id.toString()).slice(0, 14)];
                await redisClient.setEx(cacheKey, 300, JSON.stringify(cachedData));
            }
        }

        const cachedKeys = await redisClient.sMembers("cachedPostKeys");
        if (cachedKeys.length > 0) {
            await redisClient.del(cachedKeys);
            await redisClient.del("cachedPostKeys");
            // console.log("Cleared cache keys:", cachedKeys);
        }
        await redisClient.del(`post:${post._id}`);

        res.status(201).json(post);
    } catch (error) {
        console.error("Error saving post:", error.message);
        if (error.name === "ValidationError") {
            return res.status(400).json({ error: "Invalid data", details: error.errors });
        }
        return res.status(500).json({ error: "Failed to save post", details: error.message });
    }
});

router.get("/categories", apiLimiter, async (req, res) => {
    try {
        res.status(200).json({ categories: VALID_CATEGORIES });
    } catch (error) {
        console.error("Error fetching categories:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.get("/", apiLimiter, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 15, 15);
        const skip = (page - 1) * limit;
        const category = req.query.category || null;

        const cacheKey = `posts:recent:page:${page}:limit:${limit}:category:${category || 'all'}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            res.set('Cache-Control', 'no-store');
            return res.status(200).json(JSON.parse(cached));
        }

        const now = new Date();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        let query = category ? { category: { $in: [category] } } : {};
        let posts = await Post.find(query)
            .select("title mainContents createdAt category slug contentOrder")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const seenIds = new Set();
        const uniquePosts = posts.filter(post => !seenIds.has(post._id) && seenIds.add(post._id));

        const totalPosts = await Post.countDocuments(query);

        const response = {
            posts: uniquePosts,
            totalPages: Math.ceil(totalPosts / limit),
            currentPage: page,
            hasMore: uniquePosts.length === limit && skip + limit < totalPosts,
        };

        await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
        await redisClient.sAdd("cachedPostKeys", cacheKey);
        res.set('Cache-Control', 'no-store');
        res.status(200).json(response);
    } catch (error) {
        console.error("Error in GET /api/posts:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.get("/:identifier", apiLimiter, async (req, res) => {
    try {
        const { identifier } = req.params;
        const cacheKey = `post:${identifier}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            res.set('Cache-Control', 'no-store');
            return res.status(200).json(JSON.parse(cached));
        }

        const isMongoId = /^[0-9a-fA-F]{24}$/.test(identifier);
        const query = isMongoId ? { _id: identifier } : { slug: identifier };

        const post = await Post.findOne(query)
            .select("title mainContents createdAt category slug contentOrder")
            .lean();
        if (!post) {
            return res.status(404).json({ error: "Post not found" });
        }

        await redisClient.setEx(cacheKey, 7200, JSON.stringify(post));
        await redisClient.sAdd("cachedPostKeys", cacheKey);
        res.set('Cache-Control', 'no-store');
        res.status(200).json(post);
    } catch (error) {
        console.error("Error fetching post:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.get("/combined/:identifier", apiLimiter, async (req, res) => {
    try {
        const { identifier } = req.params;
        const cacheKey = `combined:${identifier}`;
        const cached = await redisClient.get(cacheKey);

        if (cached) {
            res.set('Cache-Control', 'no-store');
            return res.status(200).json(JSON.parse(cached));
        }

        const isMongoId = /^[0-9a-fA-F]{24}$/.test(identifier);
        const query = isMongoId ? { _id: identifier } : { slug: identifier };

        const post = await Post.findOne(query)
            .select("title mainContents createdAt category slug contentOrder")
            .lean();
        if (!post) {
            return res.status(404).json({ error: "Post not found" });
        }

        let relatedQuery = {
            category: { $in: post.category },
            _id: { $ne: post._id }
        };
        let related = await Post.find(relatedQuery)
            .select("title mainContents createdAt category slug contentOrder")
            .sort({ createdAt: -1 })
            .limit(15)
            .lean();

        let footballQuery = {
            category: { $in: ["Thể thao"] },
            _id: { $ne: post._id }
        };
        let football = await Post.find(footballQuery)
            .select("title mainContents createdAt category slug contentOrder")
            .sort({ createdAt: -1 })
            .limit(15)
            .lean();

        const response = { post, related, football };
        await redisClient.setEx(cacheKey, 7200, JSON.stringify(response));
        await redisClient.sAdd("cachedPostKeys", cacheKey);
        res.set('Cache-Control', 'no-store');
        res.status(200).json(response);
    } catch (error) {
        console.error("Error fetching combined post data:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;