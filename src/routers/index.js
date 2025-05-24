"use strict"
const authK = require('./auth/auth.routes');
const resultsRouterMB = require('./kqxsMB/resultMB.routes');
const resultsRouterMN = require('./kqxsMN/resultMN.routes');
const resultsRouterMT = require('./kqxsMT/resultMT.routes');
const postsRouter = require('./post/post.routes');
const statsRouter = require('./stats_thongke/stats.routes');
const calculate3D4D = require('./Dan3D4D/calculate3D4D.routes');
const telegram = require('./routestelegram');

const Routes = (app) => {
    app.use('/api/auth', authK);
    app.use('/api/ketqua', resultsRouterMN);
    app.use('/api/ketquaxs', resultsRouterMT);
    app.use('/api/kqxs', resultsRouterMB);
    app.use('/api/posts', postsRouter);
    app.use('/api/stats', statsRouter);
    app.use('/api/taodan', calculate3D4D);
    app.use('/api/kqxs/xsmb/telegram', (req, res, next) => {
        console.log('Yêu cầu đến /api/kqxs/xsmb/telegram:', req.method, req.url, req.body);
        next();
    }, telegram);
};

module.exports = Routes;