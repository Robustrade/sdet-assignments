const { test, expect } = require('@playwright/test');
const ApiHelper = require('../../utils/apiHelper');
const DatabaseHelper = require('../../utils/databaseHelper');
const TestDataBuilder = require('../../utils/testDataBuilder');

test.describe('Transfer API Validation Tests', () => {
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

  test('should successfully create a transfer with valid data', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);
  });

  test('should return 400 for missing source_wallet_id', async () => {
    const invalidRequests = TestDataBuilder.buildInvalidTransferRequests();
    const idempotencyKey = TestDataBuilder.generateIdempotencyKey();

    const response = await apiHelper.createTransfer(
      invalidRequests.missing_source,
      idempotencyKey
    );

    expect(response.status).toBe(400);
  });

  test('should return 400 for missing destination_wallet_id', async () => {
    const invalidRequests = TestDataBuilder.buildInvalidTransferRequests();
    const idempotencyKey = TestDataBuilder.generateIdempotencyKey();

    const response = await apiHelper.createTransfer(
      invalidRequests.missing_destination,
      idempotencyKey
    );

    expect(response.status).toBe(400);
  });

  test('should return 400 for missing amount', async () => {
    const invalidRequests = TestDataBuilder.buildInvalidTransferRequests();
    const idempotencyKey = TestDataBuilder.generateIdempotencyKey();

    const response = await apiHelper.createTransfer(
      invalidRequests.missing_amount,
      idempotencyKey
    );

    expect(response.status).toBe(400);
  });

  test('should return 400 for negative amount', async () => {
    const invalidRequests = TestDataBuilder.buildInvalidTransferRequests();
    const idempotencyKey = TestDataBuilder.generateIdempotencyKey();

    const response = await apiHelper.createTransfer(
      invalidRequests.negative_amount,
      idempotencyKey
    );

    expect(response.status).toBe(400);
  });

  test('should return 400 for invalid currency', async () => {
    const invalidRequests = TestDataBuilder.buildInvalidTransferRequests();
    const idempotencyKey = TestDataBuilder.generateIdempotencyKey();

    const response = await apiHelper.createTransfer(
      invalidRequests.invalid_currency,
      idempotencyKey
    );

    expect(response.status).toBe(400);
  });

  test('should return 400 when source and destination wallets are the same', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('same_wallet');
    
    await dbHelper.seedWallets([scenario.sourceWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(400);
  });

  test('should return 422 for insufficient balance', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('insufficient_balance');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(422);
  });

  test('should return 404 for non-existent source wallet', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(404);
  });

  test('should retrieve transfer by ID', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const createResponse = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(createResponse.status).toBe(201);
    const transferId = createResponse.data.transfer_id;

    const getResponse = await apiHelper.getTransfer(transferId);

    expect(getResponse.status).toBe(200);
    expect(getResponse.data.transfer_id).toBe(transferId);
    expect(getResponse.data.source_wallet_id).toBe(scenario.transferRequest.source_wallet_id);
    expect(getResponse.data.destination_wallet_id).toBe(scenario.transferRequest.destination_wallet_id);
    expect(getResponse.data.amount).toBe(scenario.transferRequest.amount);
  });

  test('should return 404 for non-existent transfer ID', async () => {
    const nonExistentId = TestDataBuilder.generateTransferId();

    const response = await apiHelper.getTransfer(nonExistentId);

    expect(response.status).toBe(404);
    expect(response.data).toHaveProperty('error');
  });

  test('should retrieve wallet by ID', async () => {
    const wallet = TestDataBuilder.buildWallet();
    
    await dbHelper.seedWallets([wallet]);

    const response = await apiHelper.getWallet(wallet.wallet_id);

    expect(response.status).toBe(200);
    expect(response.data.wallet_id).toBe(wallet.wallet_id);
    expect(response.data.balance).toBe(wallet.balance);
    expect(response.data.currency).toBe(wallet.currency);
  });
});
