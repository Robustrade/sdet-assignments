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

test.describe('Transfer Retrieval', () => {

    test('Should retrieve a transfer using transfer ID', async () => {

        const payload = testData.validTransfer({
            amount: 150,
            reference: 'Transfer Retrieval'
        });

        let transferId;

        await test.step('Create a transfer', async () => {

            const createResponse = await api.createTransfer(payload);

            expect(createResponse.status()).toBe(201);

            const createdTransfer = await createResponse.json();

            transferId = createdTransfer.id;

        });

        await test.step('Retrieve the transfer', async () => {

            const getResponse = await api.getTransfer(transferId);

            expect(getResponse.status()).toBe(200);

            const transfer = await getResponse.json();

            expect(transfer.id).toBe(transferId);
            expect(transfer.amount).toBe(150);
            expect(transfer.currency).toBe('AED');
            expect(transfer.source_wallet_id).toBe(testData.SOURCE_WALLET);
            expect(transfer.destination_wallet_id).toBe(testData.DESTINATION_WALLET);
            expect(transfer.status).toBe('completed');

        });

    });

});