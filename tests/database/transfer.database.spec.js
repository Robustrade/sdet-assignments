const { test, expect } = require('@playwright/test');
const ApiHelper = require('../../utils/apiHelper');
const DatabaseHelper = require('../../utils/databaseHelper');
const TestDataBuilder = require('../../utils/testDataBuilder');

test.describe('Transfer Database Verification Tests', () => {
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

  test('should persist transfer record correctly in database', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    const transferId = response.data.transfer_id;
    const dbTransfer = await dbHelper.getTransfer(transferId);

    expect(dbTransfer).not.toBeNull();
    expect(dbTransfer.transfer_id).toBe(transferId);
    expect(dbTransfer.source_wallet_id).toBe(scenario.transferRequest.source_wallet_id);
    expect(dbTransfer.destination_wallet_id).toBe(scenario.transferRequest.destination_wallet_id);
    expect(parseFloat(dbTransfer.amount)).toBe(scenario.transferRequest.amount);
    expect(dbTransfer.currency).toBe(scenario.transferRequest.currency);
    expect(dbTransfer.status).toBe('completed');
    expect(dbTransfer.idempotency_key).toBe(scenario.idempotencyKey);
  });

  test('should update wallet balances correctly after successful transfer', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const initialSourceBalance = scenario.sourceWallet.balance;
    const initialDestBalance = scenario.destWallet.balance;

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    const sourceWallet = await dbHelper.getWallet(scenario.sourceWallet.wallet_id);
    const destWallet = await dbHelper.getWallet(scenario.destWallet.wallet_id);

    expect(parseFloat(sourceWallet.balance)).toBe(initialSourceBalance - scenario.transferRequest.amount);
    expect(parseFloat(destWallet.balance)).toBe(initialDestBalance + scenario.transferRequest.amount);
  });

  test('should maintain balance conservation invariant', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const initialSourceBalance = scenario.sourceWallet.balance;
    const initialDestBalance = scenario.destWallet.balance;

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    const verification = await dbHelper.verifyBalanceConservation(
      scenario.sourceWallet.wallet_id,
      scenario.destWallet.wallet_id,
      initialSourceBalance,
      initialDestBalance,
      scenario.transferRequest.amount
    );

    expect(verification.isConserved).toBe(true);
    expect(verification.totalBefore).toBe(verification.totalAfter);
    expect(verification.sourceBalanceAfter).toBe(verification.expectedSourceBalance);
    expect(verification.destBalanceAfter).toBe(verification.expectedDestBalance);
  });

  test('should not persist transfer on insufficient balance', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('insufficient_balance');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const initialSourceBalance = scenario.sourceWallet.balance;
    const initialDestBalance = scenario.destWallet.balance;

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(422);

    const transfers = await dbHelper.getTransfersByIdempotencyKey(scenario.idempotencyKey);
    expect(transfers.length).toBe(0);

    const sourceBalance = await dbHelper.getWalletBalance(scenario.sourceWallet.wallet_id);
    const destBalance = await dbHelper.getWalletBalance(scenario.destWallet.wallet_id);

    expect(parseFloat(sourceBalance)).toBe(initialSourceBalance);
    expect(parseFloat(destBalance)).toBe(initialDestBalance);
  });

  test('should not persist transfer on validation failure', async () => {
    const invalidRequests = TestDataBuilder.buildInvalidTransferRequests();
    const idempotencyKey = TestDataBuilder.generateIdempotencyKey();

    const response = await apiHelper.createTransfer(
      invalidRequests.negative_amount,
      idempotencyKey
    );

    expect(response.status).toBe(400);

    const transfers = await dbHelper.getTransfersByIdempotencyKey(idempotencyKey);
    expect(transfers.length).toBe(0);
  });

  test('should store idempotency key record', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    const idempotencyRecord = await dbHelper.getIdempotencyRecord(scenario.idempotencyKey);

    expect(idempotencyRecord).not.toBeNull();
    expect(idempotencyRecord.idempotency_key).toBe(scenario.idempotencyKey);
    expect(idempotencyRecord.response_status).toBe(201);
  });

  test('should create transfer event records', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    const transferId = response.data.transfer_id;
    const events = await dbHelper.getTransferEvents(transferId);

    expect(events.length).toBeGreaterThan(0);
    
    const eventTypes = events.map(e => e.event_type);
    expect(eventTypes).toContain('transfer_initiated');
    expect(eventTypes).toContain('transfer_completed');
  });

  test('should create outbox event for successful transfer', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    const transferId = response.data.transfer_id;
    const outboxEvents = await dbHelper.getOutboxEvents(transferId);

    expect(outboxEvents.length).toBe(1);
    expect(outboxEvents[0].aggregate_id).toBe(transferId);
    expect(outboxEvents[0].event_type).toBe('TransferCompleted');
    expect(outboxEvents[0].processed).toBe(false);
  });

  test('should create audit log entries', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    const transferId = response.data.transfer_id;
    const auditLogs = await dbHelper.getAuditLogs('transfer', transferId);

    expect(auditLogs.length).toBeGreaterThan(0);
    
    const actions = auditLogs.map(log => log.action);
    expect(actions).toContain('CREATE');
  });

  test('should verify no duplicate transfer records for same idempotency key', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

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

  test('should verify exactly one outbox event per transfer', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    const transferId = response.data.transfer_id;
    const count = await dbHelper.countOutboxEventsByTransferId(transferId);
    
    expect(count).toBe(1);
  });

  test('should verify transfer timestamps are consistent', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const response = await apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    expect(response.status).toBe(201);

    const transferId = response.data.transfer_id;
    const dbTransfer = await dbHelper.getTransfer(transferId);

    expect(dbTransfer.created_at).toBeDefined();
    expect(dbTransfer.updated_at).toBeDefined();
    expect(new Date(dbTransfer.created_at).getTime()).toBeLessThanOrEqual(new Date(dbTransfer.updated_at).getTime());
  });
});
