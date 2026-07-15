const apiClient = require("../helpers/apiClient");
const { buildTransfer } = require("../builders/transferBuilder");
const resetDatabase = require("../helpers/resetDatabase");

describe("Concurrent Transfers", () => {

    beforeEach(async () => {
        await resetDatabase();
    });

    test("should process concurrent requests", async () => {

        const first = apiClient.createTransfer(
            buildTransfer({ reference: "A" }),
            `A-${Date.now()}`
        );

        const second = apiClient.createTransfer(
            buildTransfer({ reference: "B" }),
            `B-${Date.now()}`
        );

        const responses = await Promise.all([first, second]);

        expect(responses[0].status).toBe(201);
        expect(responses[1].status).toBe(201);

    });

});