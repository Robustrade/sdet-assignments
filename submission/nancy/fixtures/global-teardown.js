// fixtures/global-teardown.js
module.exports = async () => {
  if (global.__SERVER__) global.__SERVER__.close();
};
