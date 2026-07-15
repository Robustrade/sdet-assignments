const apiClient = require("../helpers/apiClient");
const { buildTransfer } = require("../builders/transferBuilder");
const dbHelper = require("../helpers/databaseHelper");
const resetDatabase = require("../helpers/resetDatabase");

describe("Transfer Workflow", () => {

    beforeEach(async () => {
        await resetDatabase();
    });

    test("should complete end-to-end transfer", async () => {

        const response = await apiClient.createTransfer(
            buildTransfer(),
            `workflow-${Date.now()}`
        );

        expect(response.status).toBe(201);

        const transfer = await dbHelper.getTransfer(response.body.id);

        expect(transfer).toBeDefined();

    });

});