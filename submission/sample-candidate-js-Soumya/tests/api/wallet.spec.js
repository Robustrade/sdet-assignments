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

test.describe('Wallet Balance Validation', () => {

    test('Wallet balances should update after successful transfer', async () => {

        const amount = 300;

        const payload = testData.validTransfer({
            amount,
            reference: 'Wallet Balance Test'
        });

        await test.step('Get wallet balances before transfer', async () => {

            const sourceResponse = await api.getWallet(testData.SOURCE_WALLET);
            const destinationResponse = await api.getWallet(testData.DESTINATION_WALLET);

            global.sourceBefore = await sourceResponse.json();
            global.destinationBefore = await destinationResponse.json();

        });

        await test.step('Create transfer', async () => {

            const transferResponse = await api.createTransfer(payload);

            expect(transferResponse.status()).toBe(201);

        });

        await test.step('Verify updated wallet balances', async () => {

            const sourceResponse = await api.getWallet(testData.SOURCE_WALLET);
            const destinationResponse = await api.getWallet(testData.DESTINATION_WALLET);

            const sourceAfter = await sourceResponse.json();
            const destinationAfter = await destinationResponse.json();

            expect(sourceAfter.balance)
                .toBe(global.sourceBefore.balance - amount);

            expect(destinationAfter.balance)
                .toBe(global.destinationBefore.balance + amount);

        });

    });

});