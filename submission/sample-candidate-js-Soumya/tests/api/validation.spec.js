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

test.describe('Transfer Validation', () => {

    test('Transfer should fail when source wallet is missing', async () => {

        const payload = testData.validTransfer();
        delete payload.source_wallet_id;

        const response = await api.createTransfer(payload);

        expect(response.status()).toBe(422);

        const body = await response.json();

        expect(body).toHaveProperty('error');
        expect(body.error).toBe('missing fields');
        expect(body.fields).toContain('source_wallet_id');
    });

    test('Transfer should fail for invalid currency', async () => {

        const response = await api.createTransfer(
            testData.invalidCurrencyTransfer()
        );

        expect(response.status()).toBe(422);

        const body = await response.json();

        expect(body).toHaveProperty('error');
        expect(body.error).toBe('invalid currency');
    });

    test('Transfer should fail for zero amount', async () => {

        const response = await api.createTransfer(
            testData.zeroAmountTransfer()
        );

        expect(response.status()).toBe(422);

        const body = await response.json();

        expect(body).toHaveProperty('error');
        expect(body.error).toBe('amount must be positive');
    });

    test('Transfer should fail when source and destination wallets are same', async () => {

        const response = await api.createTransfer(
            testData.validTransfer({
                destination_wallet_id: testData.SOURCE_WALLET
            })
        );

        expect(response.status()).toBe(422);

        const body = await response.json();

        expect(body).toHaveProperty('error');
        expect(body.error).toBe('source and destination must differ');
    });

});