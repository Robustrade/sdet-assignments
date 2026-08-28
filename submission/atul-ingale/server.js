const http = require('http');
const app = require('./src/app');
const eventHub = require('./src/eventHub');

const PORT = 3000;
const server = http.createServer(app);

eventHub.init(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, server };
