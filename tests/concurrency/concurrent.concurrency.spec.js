const { test, expect } = require('@playwright/test');
const ApiHelper = require('../../utils/apiHelper');
const DatabaseHelper = require('../../utils/databaseHelper');
const TestDataBuilder = require('../../utils/testDataBuilder');

test.describe('Concurrency and Race Condition Tests', () => {
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

  test('should handle concurrent transfers from same wallet with limited balance', async () => {
    const scenario = TestDataBuilder.buildConcurrentTransferScenario(5000, 2000, 3);
    
    await dbHelper.seedWallets([scenario.sourceWallet]);
    
    for (const transfer of scenario.transfers) {
      const destWallet = TestDataBuilder.buildWallet({
        wallet_id: transfer.transferRequest.destination_wallet_id,
        balance: 0,
      });
      await dbHelper.seedWallets([destWallet]);
    }

    const promises = scenario.transfers.map(transfer =>
      apiHelper.createTransfer(transfer.transferRequest, transfer.idempotencyKey)
    );

    const responses = await Promise.all(promises);

    const successfulTransfers = responses.filter(r => r.status === 201);
    const failedTransfers = responses.filter(r => r.status === 422);

    expect(successfulTransfers.length).toBe(scenario.expectedSuccessfulTransfers);
    expect(failedTransfers.length).toBe(scenario.transfers.length - scenario.expectedSuccessfulTransfers);

    const finalBalance = await dbHelper.getWalletBalance(scenario.sourceWallet.wallet_id);
    const expectedBalance = scenario.sourceWallet.balance - (successfulTransfers.length * 2000);
    
    expect(parseFloat(finalBalance)).toBe(expectedBalance);
  });

  test('should handle concurrent duplicate requests with same idempotency key', async () => {
    const scenario = TestDataBuilder.buildIdempotencyTestScenario();
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const initialSourceBalance = scenario.sourceWallet.balance;
    const initialDestBalance = scenario.destWallet.balance;

    const promises = [];
    for (let i = 0; i < 10; i++) {
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

    const transferIds = [...new Set(successResponses.map(r => r.data.transfer_id))];
    expect(transferIds.length).toBe(1);

    const sourceBalance = await dbHelper.getWalletBalance(scenario.sourceWallet.wallet_id);
    const destBalance = await dbHelper.getWalletBalance(scenario.destWallet.wallet_id);

    expect(parseFloat(sourceBalance)).toBe(initialSourceBalance - scenario.transferRequest.amount);
    expect(parseFloat(destBalance)).toBe(initialDestBalance + scenario.transferRequest.amount);

    const transferCount = await dbHelper.countTransfersByIdempotencyKey(scenario.idempotencyKey);
    expect(transferCount).toBe(1);
  });

  test('should maintain balance conservation under concurrent transfers', async () => {
    const sourceWallet = TestDataBuilder.buildWallet({
      wallet_id: TestDataBuilder.generateWalletId('concurrent_source'),
      balance: 10000,
    });

    const destWallets = TestDataBuilder.buildMultipleWallets(5, 5000);
    
    await dbHelper.seedWallets([sourceWallet, ...destWallets]);

    const initialTotalBalance = sourceWallet.balance + (destWallets.length * 5000);

    const transfers = destWallets.map(destWallet => ({
      transferRequest: TestDataBuilder.buildTransferRequest({
        source_wallet_id: sourceWallet.wallet_id,
        destination_wallet_id: destWallet.wallet_id,
        amount: 1000,
      }),
      idempotencyKey: TestDataBuilder.generateIdempotencyKey(),
    }));

    const promises = transfers.map(transfer =>
      apiHelper.createTransfer(transfer.transferRequest, transfer.idempotencyKey)
    );

    await Promise.all(promises);

    const finalSourceBalance = await dbHelper.getWalletBalance(sourceWallet.wallet_id);
    let finalTotalBalance = parseFloat(finalSourceBalance);

    for (const destWallet of destWallets) {
      const balance = await dbHelper.getWalletBalance(destWallet.wallet_id);
      finalTotalBalance += parseFloat(balance);
    }

    expect(finalTotalBalance).toBe(initialTotalBalance);
  });

  test('should handle race condition between concurrent reads and writes', async () => {
    const scenario = TestDataBuilder.buildTransferScenario('happy_path');
    
    await dbHelper.seedWallets([scenario.sourceWallet, scenario.destWallet]);

    const transferPromise = apiHelper.createTransfer(
      scenario.transferRequest,
      scenario.idempotencyKey
    );

    const readPromises = [];
    for (let i = 0; i < 5; i++) {
      readPromises.push(apiHelper.getWallet(scenario.sourceWallet.wallet_id));
    }

    const [transferResponse, ...readResponses] = await Promise.all([
      transferPromise,
      ...readPromises,
    ]);

    expect(transferResponse.status).toBe(201);

    readResponses.forEach(response => {
      expect(response.status).toBe(200);
      expect(response.data.wallet_id).toBe(scenario.sourceWallet.wallet_id);
    });
  });

  test('should prevent double-spending with concurrent transfers', async () => {
    const sourceWallet = TestDataBuilder.buildWallet({
      wallet_id: TestDataBuilder.generateWalletId('double_spend_source'),
      balance: 3000,
    });

    const destWallet1 = TestDataBuilder.buildWallet({
      wallet_id: TestDataBuilder.generateWalletId('double_spend_dest1'),
      balance: 0,
    });

    const destWallet2 = TestDataBuilder.buildWallet({
      wallet_id: TestDataBuilder.generateWalletId('double_spend_dest2'),
      balance: 0,
    });

    await dbHelper.seedWallets([sourceWallet, destWallet1, destWallet2]);

    const transfer1 = {
      transferRequest: TestDataBuilder.buildTransferRequest({
        source_wallet_id: sourceWallet.wallet_id,
        destination_wallet_id: destWallet1.wallet_id,
        amount: 2500,
      }),
      idempotencyKey: TestDataBuilder.generateIdempotencyKey(),
    };

    const transfer2 = {
      transferRequest: TestDataBuilder.buildTransferRequest({
        source_wallet_id: sourceWallet.wallet_id,
        destination_wallet_id: destWallet2.wallet_id,
        amount: 2500,
      }),
      idempotencyKey: TestDataBuilder.generateIdempotencyKey(),
    };

    const [response1, response2] = await Promise.all([
      apiHelper.createTransfer(transfer1.transferRequest, transfer1.idempotencyKey),
      apiHelper.createTransfer(transfer2.transferRequest, transfer2.idempotencyKey),
    ]);

    const successCount = [response1, response2].filter(r => r.status === 201).length;
    const failureCount = [response1, response2].filter(r => r.status === 422).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    const finalSourceBalance = await dbHelper.getWalletBalance(sourceWallet.wallet_id);
    expect(parseFloat(finalSourceBalance)).toBe(500);
  });

  test('should handle concurrent transfers to same destination wallet', async () => {
    const destWallet = TestDataBuilder.buildWallet({
      wallet_id: TestDataBuilder.generateWalletId('concurrent_dest'),
      balance: 0,
    });

    const sourceWallets = TestDataBuilder.buildMultipleWallets(3, 10000);
    
    await dbHelper.seedWallets([destWallet, ...sourceWallets]);

    const initialDestBalance = destWallet.balance;

    const transfers = sourceWallets.map(sourceWallet => ({
      transferRequest: TestDataBuilder.buildTransferRequest({
        source_wallet_id: sourceWallet.wallet_id,
        destination_wallet_id: destWallet.wallet_id,
        amount: 1000,
      }),
      idempotencyKey: TestDataBuilder.generateIdempotencyKey(),
    }));

    const promises = transfers.map(transfer =>
      apiHelper.createTransfer(transfer.transferRequest, transfer.idempotencyKey)
    );

    const responses = await Promise.all(promises);

    const successfulTransfers = responses.filter(r => r.status === 201);
    expect(successfulTransfers.length).toBe(3);

    const finalDestBalance = await dbHelper.getWalletBalance(destWallet.wallet_id);
    expect(parseFloat(finalDestBalance)).toBe(initialDestBalance + 3000);
  });

  test('should handle mixed concurrent operations on same wallet', async () => {
    const wallet = TestDataBuilder.buildWallet({
      wallet_id: TestDataBuilder.generateWalletId('mixed_ops'),
      balance: 10000,
    });

    await dbHelper.seedWallets([wallet]);

    const operations = [];

    for (let i = 0; i < 5; i++) {
      operations.push(apiHelper.getWallet(wallet.wallet_id));
    }

    const destWallet = TestDataBuilder.buildWallet({
      wallet_id: TestDataBuilder.generateWalletId('mixed_dest'),
      balance: 0,
    });
    await dbHelper.seedWallets([destWallet]);

    const transferRequest = TestDataBuilder.buildTransferRequest({
      source_wallet_id: wallet.wallet_id,
      destination_wallet_id: destWallet.wallet_id,
      amount: 1000,
    });

    operations.push(
      apiHelper.createTransfer(transferRequest, TestDataBuilder.generateIdempotencyKey())
    );

    const results = await Promise.all(operations);

    const readResults = results.slice(0, 5);
    const transferResult = results[5];

    readResults.forEach(result => {
      expect(result.status).toBe(200);
    });

    expect(transferResult.status).toBe(201);
  });

  test('should verify no lost updates under concurrent modifications', async () => {
    const sourceWallet = TestDataBuilder.buildWallet({
      wallet_id: TestDataBuilder.generateWalletId('lost_update_source'),
      balance: 10000,
    });

    const destWallets = TestDataBuilder.buildMultipleWallets(10, 0);
    
    await dbHelper.seedWallets([sourceWallet, ...destWallets]);

    const transfers = destWallets.map(destWallet => ({
      transferRequest: TestDataBuilder.buildTransferRequest({
        source_wallet_id: sourceWallet.wallet_id,
        destination_wallet_id: destWallet.wallet_id,
        amount: 500,
      }),
      idempotencyKey: TestDataBuilder.generateIdempotencyKey(),
    }));

    const promises = transfers.map(transfer =>
      apiHelper.createTransfer(transfer.transferRequest, transfer.idempotencyKey)
    );

    const responses = await Promise.all(promises);

    const successfulTransfers = responses.filter(r => r.status === 201);

    const finalSourceBalance = await dbHelper.getWalletBalance(sourceWallet.wallet_id);
    const expectedBalance = sourceWallet.balance - (successfulTransfers.length * 500);

    expect(parseFloat(finalSourceBalance)).toBe(expectedBalance);

    const dbTransfers = await dbHelper.getTransfersByWallet(sourceWallet.wallet_id);
    expect(dbTransfers.length).toBe(successfulTransfers.length);
  });
});
