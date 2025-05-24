const express = require('express');
const router = express.Router();
const { calculate3D, calculate4D, ngaunhien9x } = require('../../controllers/calculate3D4D.controller');

// Route để tính toán cho 3D
router.post('/taodan3d', calculate3D);

// Route để tính toán cho 4D
router.post('/taodan4d', calculate4D);

router.post('/ngaunhien9x0x', ngaunhien9x);


module.exports = router;