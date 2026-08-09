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

test.describe('Happy Path - Wallet Transfer', () => {

    test('Successful wallet transfer', async () => {

        const payload = testData.validTransfer({
            amount: 100,
            reference: 'Happy Path'
        });

        await test.step('Create a transfer', async () => {

            const response = await api.createTransfer(payload);

            expect(response.status()).toBe(201);

            const body = await response.json();

            expect(body.id).toBeTruthy();
            expect(body.status).toBe('completed');
            expect(body.amount).toBe(100);
            expect(body.currency).toBe('AED');
            expect(body.source_wallet_id).toBe(testData.SOURCE_WALLET);
            expect(body.destination_wallet_id).toBe(testData.DESTINATION_WALLET);

        });

    });

});