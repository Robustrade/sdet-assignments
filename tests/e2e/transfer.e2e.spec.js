const { test, expect } = require('@playwright/test');
const ApiHelper = require('../../utils/apiHelper');
const DatabaseHelper = require('../../utils/databaseHelper');
const TestDataBuilder = require('../../utils/testDataBuilder');

test.describe('End-to-End Transfer Workflow Tests', () => {
  let apiHelper;
  let dbHelper;

  test.beforeAll(async () => {
    apiHelper = new ApiHelper();
    dbHelper = new DatabaseHelper();
  });

  test.afterAll(async () => {
    await dbHelper.close();
  });

  test.beforeEach(async () => {
    await dbHelper.cleanupTestData();
  });

  test('should complete full transfer lifecycle from API to database', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const initialSourceBalance = scenario.sourceWallet.balance;
    const initialDestBalance = scenario.destWallet.balance;

    const createResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(createResponse.status).toBe(201);
    expect(createResponse.data).toHaveProperty('transfer_id');
    expect(createResponse.data.status).toBe('completed');

    const transferId = createResponse.data.transfer_id;

    const getTransferResponse = await apiHelper.getTransfer(transferId);
    expect(getTransferResponse.status).toBe(200);
    expect(getTransferResponse.data.transfer_id).toBe(transferId);

    const dbTransfer = await dbHelper.getTransfer(transferId);
    expect(dbTransfer).not.toBeNull();
    expect(dbTransfer.status).toBe('completed');

    const sourceWallet = await dbHelper.getWallet(scenario.sourceWallet.wallet_id);
    const destWallet = await dbHelper.getWallet(scenario.destWallet.wallet_id);

    expect(parseFloat(sourceWallet.balance)).toBe(initialSourceBalance - scenario.transferRequest.amount);
    expect(parseFloat(destWallet.balance)).toBe(initialDestBalance + scenario.transferRequest.amount);

    const events = await dbHelper.getTransferEvents(transferId);
    expect(events.length).toBeGreaterThan(0);

    const outboxEvents = await dbHelper.getOutboxEvents(transferId);
    expect(outboxEvents.length).toBe(1);

    const auditLogs = await dbHelper.getAuditLogs('transfer', transferId);
    expect(auditLogs.length).toBeGreaterThan(0);
  });
});
