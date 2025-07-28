const { server } = require('./app');

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`HTTP/2 server running on port ${PORT}`);
});