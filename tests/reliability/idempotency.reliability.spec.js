const { test, expect } = require('@playwright/test');
const ApiHelper = require('../../utils/apiHelper');
const DatabaseHelper = require('../../utils/databaseHelper');
const TestDataBuilder = require('../../utils/testDataBuilder');

test.describe('Idempotency and Duplicate Request Tests', () => {
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

  test('should return same result for duplicate request with same idempotency key', async () => {
    const scenario = TestDataBuilder.buildIdempotencyTestScenario();
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const firstResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(firstResponse.status).toBe(201);
    const firstTransferId = firstResponse.data.transfer_id;

    const secondResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(secondResponse.status).toBe(201);
    expect(secondResponse.data.transfer_id).toBe(firstTransferId);
    expect(secondResponse.data.status).toBe(firstResponse.data.status);
    expect(secondResponse.data.amount).toBe(firstResponse.data.amount);
  });

  test('should not double-debit source wallet on duplicate request', async () => {
    const scenario = TestDataBuilder.buildIdempotencyTestScenario();
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const initialSourceBalance = scenario.sourceWallet.balance;

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    const sourceBalance = await dbHelper.getWalletBalance(scenario.sourceWallet.wallet_id);
    const expectedBalance = initialSourceBalance - scenario.transferRequest.amount;

    expect(parseFloat(sourceBalance)).toBe(expectedBalance);
  });

  test('should not double-credit destination wallet on duplicate request', async () => {
    const scenario = TestDataBuilder.buildIdempotencyTestScenario();
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const initialDestBalance = scenario.destWallet.balance;

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    const destBalance = await dbHelper.getWalletBalance(scenario.destWallet.wallet_id);
    const expectedBalance = initialDestBalance + scenario.transferRequest.amount;

    expect(parseFloat(destBalance)).toBe(expectedBalance);
  });

  test('should reject duplicate request with same key but different payload', async () => {
    const scenario = TestDataBuilder.buildIdempotencyTestScenario();
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const firstResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(firstResponse.status).toBe(201);

    const secondResponse = await apiHelper.createTransfer(
      scenario.modifiedTransferRequest,
      scenario.idempotencyKey
    );

    expect(secondResponse.status).toBe(409);
    expect(secondResponse.data).toHaveProperty('error');
    expect(secondResponse.data.error).toMatch(/idempotency.*conflict|payload.*mismatch/i);
  });

  test('should create only one transfer record for duplicate requests', async () => {
    const scenario = TestDataBuilder.buildIdempotencyTestScenario();
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    const count = await dbHelper.countTransfersByIdempotencyKey(scenario.idempotencyKey);
    expect(count).toBe(1);
  });

  test('should handle multiple duplicate requests in rapid succession', async () => {
    const scenario = TestDataBuilder.buildIdempotencyTestScenario();
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const initialSourceBalance = scenario.sourceWallet.balance;
    const initialDestBalance = scenario.destWallet.balance;

    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        apiHelper.createTransfer(
          scenario.transferRequest,
          scenario.idempotencyKey
        )
      );
    }

    const responses = await Promise.all(promises);

    const successResponses = responses.filter(r => r.status === 201);
    expect(successResponses.length).toBeGreaterThan(0);

    const transferIds = successResponses.map(r => r.data.transfer_id);
    const uniqueTransferIds = [...new Set(transferIds)];
    expect(uniqueTransferIds.length).toBe(1);

    const sourceBalance = await dbHelper.getWalletBalance(scenario.sourceWallet.wallet_id);
    const destBalance = await dbHelper.getWalletBalance(scenario.destWallet.wallet_id);

    expect(parseFloat(sourceBalance)).toBe(initialSourceBalance - scenario.transferRequest.amount);
    expect(parseFloat(destBalance)).toBe(initialDestBalance + scenario.transferRequest.amount);
  });

  test('should preserve idempotency across failed and successful retries', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('insufficient_balance');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const failedResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(failedResponse.status).toBe(422);

    await dbHelper.updateWalletBalance(
      scenario.sourceWallet.wallet_id,
      scenario.transferRequest.amount + 1000
    );

    const retryResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(retryResponse.status).toBe(422);
    expect(retryResponse.data.error).toBe(failedResponse.data.error);
  });

  test('should allow different transfers with different idempotency keys', async () => {
    const scenario1 = TestDataBuilder.buildTransferScenario('happy_path');
    const scenario2 = TestDataBuilder.buildTransferScenario('happy_path');
    
    scenario2.sourceWallet = scenario1.sourceWallet;
    scenario2.destWallet = scenario1.destWallet;
    scenario2.transferRequest.source_wallet_id = scenario1.sourceWallet.wallet_id;
    scenario2.transferRequest.destination_wallet_id = scenario1.destWallet.wallet_id;
    scenario2.transferRequest.amount = 1500;

    await dbHelper.updateWalletBalance(scenario1.sourceWallet.wallet_id, 20000);
    await dbHelper.seedWallets([scenario1.destWallet]);

    const response1 = await apiHelper.createTransfer(
      scenario1.transferRequest,
      scenario1.idempotencyKey
    );

    const response2 = await apiHelper.createTransfer(
      scenario2.transferRequest,
      scenario2.idempotencyKey
    );

    expect(response1.status).toBe(201);
    expect(response2.status).toBe(201);
    expect(response1.data.transfer_id).not.toBe(response2.data.transfer_id);
  });

  test('should maintain idempotency for failed transfers', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('insufficient_balance');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const firstResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(firstResponse.status).toBe(422);

    const secondResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(secondResponse.status).toBe(422);
    expect(secondResponse.data.error).toBe(firstResponse.data.error);

    const transfers = await dbHelper.getTransfersByIdempotencyKey(scenario.idempotencyKey);
    expect(transfers.length).toBe(0);
  });

  test('should verify idempotency record contains request hash', async () => {
    const scenario = TestDataBuilder.buildIdempotencyTestScenario();
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    const idempotencyRecord = await dbHelper.getIdempotencyRecord(scenario.idempotencyKey);

    expect(idempotencyRecord).not.toBeNull();
    expect(idempotencyRecord.request_hash).toBeDefined();
    expect(idempotencyRecord.request_hash.length).toBeGreaterThan(0);
  });
});
