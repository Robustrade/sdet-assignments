const { request } = require('@playwright/test');
const { createTestApp } = require('./appFactory');
const { SubscriptionApi } = require('../pom/subscriptionApi');

async function boot() {
  const fixture = createTestApp();
  const server = fixture.app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const apiRequest = await request.newContext({
    baseURL: `http://127.0.0.1:${port}`,
  });

  const api = new SubscriptionApi(apiRequest);

  return {
    ...fixture,
    api,
    close: async () => {
      await apiRequest.dispose();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  boot,
};
