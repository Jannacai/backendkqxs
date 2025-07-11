// "use strict"
// const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');
// const userModel = require('../models/users.models')


// class AccessController {
//     Register = async (req, res) => {
//         const { username, fullname, password } = req.body;
//         try {
//             const existingUser = await userModel.findOne({ username });
//             if (existingUser) {
//                 return res.status(400).json({ error: 'Username already exists' });
//             }
//             const hashedPassword = await bcrypt.hash(password, 10);
//             const user = new User({ username, fullname, password: hashedPassword });
//             await user.save();
//             res.status(201).json({ message: 'User registered successfully' });
//         } catch (error) {
//             res.status(500).json({ error: 'Internal Server Error' });
//         }
//     };

//     Login = async (req, res) => {
//         const { username, password } = req.body;
//         try {
//             const user = await userModel.findOne({ username });
//             if (!user) {
//                 return res.status(400).json({ error: 'Invalid credentials' });
//             }
//             const isMatch = await bcrypt.compare(password, user.password);
//             if (!isMatch) {
//                 return res.status(400).json({ error: 'Invalid credentials' });
//             }
//             const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '3h' });
//             res.status(200).json({ token });
//         } catch (error) {
//             res.status(500).json({ error: 'Internal Server Error' });
//         }
//     }

// }

// module.exports = new AccessController();