const { request } = require('@playwright/test');
const { randomUUID } = require('crypto');
const endpoints = require('./endpoints');

class ApiClient {

    async init() {
        this.api = await request.newContext({
            baseURL: 'http://localhost:3000'
        });
    }

    generateIdempotencyKey() {
        return randomUUID();
    }

    async createTransfer(payload, key = this.generateIdempotencyKey()) {
        return this.api.post(endpoints.TRANSFERS, {
            data: payload,
            headers: {
                'Idempotency-Key': key
            }
        });
    }

    async getWallet(walletId) {
        return this.api.get(`${endpoints.WALLETS}/${walletId}`);
    }

    async getTransfer(transferId) {
        return this.api.get(`${endpoints.TRANSFERS}/${transferId}`);
    }

    async dispose() {
        await this.api.dispose();
    }
}

module.exports = ApiClient;