const apiClient = require("../helpers/apiClient");
const { buildTransfer } = require("../builders/transferBuilder");
const resetDatabase = require("../helpers/resetDatabase");

describe("Idempotency", () => {

    beforeEach(async () => {
        await resetDatabase();
    });

    test("should return completed for duplicate request", async () => {

        const key = `duplicate-${Date.now()}`;
        const transfer = buildTransfer();

        const first = await apiClient.createTransfer(transfer, key);

        const second = await apiClient.createTransfer(transfer, key);

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);

        expect(second.body.status).toBe("completed");
    });

});