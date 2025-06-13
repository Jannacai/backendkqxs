const express = require("express");
const router = express.Router();
const userModel = require("../../models/users.models");
const { authenticate } = require("./auth.routes");

// GET: Tìm kiếm người dùng theo fullname
router.get("/search", authenticate, async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ error: "Query là bắt buộc" });
        }z

        const users = await userModel
            .find({
                fullname: { $regex: `^${query}`, $options: "i" },
            })
            .select("username fullname role")
            .limit(5); // Giới hạn 5 gợi ý
        res.status(200).json(users);
    } catch (error) {
        console.error("Error in /users/search:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;