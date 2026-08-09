// fixtures/global-setup.js
const { start } = require('../src/server');

let server;

module.exports = async () => {
  server = start(3001);
  // wait until port is open
  await new Promise((resolve) => setTimeout(resolve, 300));
  global.__SERVER__ = server;
  process.env.BASE_URL = 'http://localhost:3001';
};
