import { test, expect } from '../../src/fixtures/apiFixtures';
import { DataGenerator } from '../../src/utils/DataGenerator';

test.describe('User API @smoke @regression', () => {
  test('should create a user', async ({ userApi }) => {
    const user = {
      name: DataGenerator.randomName(),
      email: DataGenerator.randomEmail(),
    };

    const response = await userApi.createUser(user);

    expect(response.status()).toBe(201);

    const body = await response.json();

    expect(body).toHaveProperty('id');
    expect(body.name).toBe(user.name);
    expect(body.email).toBe(user.email);
  });

  test('should get users', async ({ userApi }) => {
    const response = await userApi.getUsers();

    expect(response.ok()).toBeTruthy();

    const body = await response.json();

    expect(body).toBeDefined();
  });

  test('should return 404 for non-existing user', async ({ userApi }) => {
    const response = await userApi.getUser('non-existing-user-id');

    expect(response.status()).toBe(404);
  });
});
