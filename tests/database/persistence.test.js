const apiClient = require("../helpers/apiClient");
const { buildTransfer } = require("../builders/transferBuilder");
const dbHelper = require("../helpers/databaseHelper");
const resetDatabase = require("../helpers/resetDatabase");

describe("Database Persistence", () => {

    beforeEach(async () => {
        await resetDatabase();
    });

    test("should save transfer in database", async () => {

        const transfer = buildTransfer();

        const response = await apiClient.createTransfer(
            transfer,
            `db-${Date.now()}`
        );

        const dbTransfer = await dbHelper.getTransfer(response.body.id);

        expect(dbTransfer).toBeDefined();
    });

});