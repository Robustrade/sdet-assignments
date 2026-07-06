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

test.describe('Insufficient Balance Validation', () => {

    test('Transfer should fail when source wallet has insufficient balance', async () => {

        const response = await api.createTransfer(
            testData.insufficientBalanceTransfer()
        );

        expect(response.status()).toBe(422);

        const body = await response.json();

        expect(body).toHaveProperty('error');
        expect(body.error).toBe('insufficient balance');

    });

});