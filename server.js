const { server } = require("./app");

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server HTTP/2 running at https://localhost:${PORT}`);
});