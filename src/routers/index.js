"use strict"
// const userRoutes = require('./auth/user.routes');
// const { router: authK } = require('./auth/auth.routes');
// const commentRoutes = require('./auth/comment.routes');
// const notificationRoutes = require('./auth/notification.routes');
// const groupchatRoutes = require('./auth/groupchat.routes');
// const lotteryRoutes = require('./lottery/lottery');
const resultsRouterMB = require('./kqxsMB/resultMB.routes');
const LiveRouterMB = require('./kqxsMB/xsmbLiveRoutes');
const LiveRouterMT = require('./kqxsMT/xsmtLiveRoutes');
const LiveRouterMN = require('./kqxsMN/xsmnLive.routes');


const soicauRouterMB = require('./kqxsMB/soicau.routes');

const resultsRouterMN = require('./kqxsMN/resultMN.routes');
const resultsRouterMT = require('./kqxsMT/resultMT.routes');

// const postsRouter = require('./post/post.routes');
// const eventRouter = require('./Events/events.routes')
// const statsRouter = require('./stats_thongke/stats.routes');
const calculate3D4D = require('./Dan3D4D/calculate3D4D.routes');
const telegram = require('./routestelegram');

const Routes = (app) => {
    app.use('/api/kqxs/xsmb/sse', LiveRouterMB);
    app.use('/api/ketquaxs/xsmt/sse', LiveRouterMT);
    app.use('/api/ketqua/xsmn/sse', LiveRouterMN);
    app.use('/api/kqxs', resultsRouterMB);
    app.use('/api/ketqua', resultsRouterMN);
    app.use('/api/ketquaxs', resultsRouterMT);
    app.use('/api/kqxs/xsmb/soicau', soicauRouterMB);


    // app.use('/api/posts', postsRouter);
    // app.use('/api/stats', statsRouter);
    app.use('/api/taodan', calculate3D4D);
    app.use('/api/kqxs/xsmb/telegram', (req, res, next) => {
        console.log('Yêu cầu đến /api/kqxs/xsmb/telegram:', req.method, req.url, req.body);
        next();
    }, telegram);
};

module.exports = Routes;