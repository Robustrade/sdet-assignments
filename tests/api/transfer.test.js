const apiClient = require("../helpers/apiClient");
const { buildTransfer } = require("../builders/transferBuilder");
const dbHelper = require("../helpers/databaseHelper");
const resetDatabase = require("../helpers/resetDatabase");

describe("Wallet Transfer API", () => {

    beforeEach(async () => {
        await resetDatabase();
    });

    test("should transfer money successfully", async () => {

        const transfer = buildTransfer({
            amount: 10
        });

        const sourceBefore =
            await dbHelper.getWallet("wallet_001");


        const destinationBefore =
            await dbHelper.getWallet("wallet_002");


        const response =
            await apiClient.createTransfer(
                transfer,
                `test-${Date.now()}`
            );


        expect(response.status).toBe(201);

        expect(response.body.status).toBe("completed");

        expect(response.body.id).toBeDefined();

        const sourceAfter =
            await dbHelper.getWallet("wallet_001");


        const destinationAfter =
            await dbHelper.getWallet("wallet_002");


        expect(sourceAfter.balance).toBeLessThan(sourceBefore.balance);
        expect(destinationAfter.balance).toBeGreaterThan(destinationBefore.balance);

    });
    test("should reject negative amount", async () => {

        const transfer = buildTransfer({
            amount: -100
        });

        const response = await apiClient.createTransfer(
            transfer,
            `negative-${Date.now()}`
        );

        expect(response.status).toBe(400);
    });

    test("should reject zero amount", async () => {

        const transfer = buildTransfer({
            amount: 0
        });

        const response = await apiClient.createTransfer(
            transfer,
            `zero-${Date.now()}`
        );

        expect(response.status).toBe(400);
    });

    test("should reject same source and destination wallet", async () => {

        const transfer = buildTransfer({
            destination_wallet_id: "wallet_001"
        });

        const response = await apiClient.createTransfer(
            transfer,
            `same-${Date.now()}`
        );

        expect(response.status).toBe(400);
    });



});