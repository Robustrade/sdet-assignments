const { test, expect } = require('@playwright/test');
const ApiClient = require('../helpers/apiClient');
const testData = require('../helpers/testData');

let api;

test.beforeAll(async () => {
    api = new ApiClient();
    await api.init();
});

test.afterAll(async () => {
    await api.dispose();
});

test.describe('Idempotency Validation', () => {

    test('Same idempotency key with same payload should return existing transfer', async () => {

        const payload = testData.validTransfer({
            amount: 200
        });

        const key = api.generateIdempotencyKey();

        const firstResponse = await api.createTransfer(payload, key);

        expect(firstResponse.status()).toBe(201);

        const firstBody = await firstResponse.json();

        const secondResponse = await api.createTransfer(payload, key);

        expect(secondResponse.status()).toBe(200);

        const secondBody = await secondResponse.json();

        expect(secondBody.id).toBe(firstBody.id);
        expect(secondBody.status).toBe('completed');
        expect(secondBody.amount).toBe(200);
    });

    test('Same idempotency key with different payload should return conflict', async () => {

        const key = api.generateIdempotencyKey();

        const firstPayload = testData.validTransfer({
            amount: 100
        });

        const secondPayload = testData.validTransfer({
            amount: 500
        });

        const firstResponse = await api.createTransfer(firstPayload, key);

        expect(firstResponse.status()).toBe(201);

        const secondResponse = await api.createTransfer(secondPayload, key);

        expect(secondResponse.status()).toBe(409);

        const body = await secondResponse.json();

        expect(body).toHaveProperty('error');
        expect(body.error).toBe('idempotency key conflict');
    });

});