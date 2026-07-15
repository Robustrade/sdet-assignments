const request = require("supertest");
const app = require("../../src/app");

async function createTransfer(body, idempotencyKey) {
    return request(app)
        .post("/transfers")
        .set("Idempotency-Key", idempotencyKey)
        .send(body);
}

async function getWallet(walletId) {
    return request(app)
        .get(`/wallets/${walletId}`);
}

module.exports = {
    createTransfer,
    getWallet
};