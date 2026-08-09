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

test.describe('Reliability Tests', () => {

    test('Multiple transfers should complete successfully', async () => {

        const transferCount = 10;

        const requests = [];

        for (let i = 0; i < transferCount; i++) {

            requests.push(
                api.createTransfer(
                    testData.validTransfer({
                        amount: 10,
                        reference: `Reliability-${i + 1}`
                    })
                )
            );

        }

        const responses = await Promise.all(requests);

        expect(responses.length).toBe(transferCount);

        for (const response of responses) {

            expect(response.status()).toBe(201);

            const body = await response.json();

            expect(body.id).toBeTruthy();
            expect(body.status).toBe('completed');

        }

    });

});