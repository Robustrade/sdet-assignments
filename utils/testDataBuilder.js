const { v4: uuidv4 } = require('uuid');

class TestDataBuilder {
  static generateWalletId(prefix = 'wallet') {
    return `${prefix}_${uuidv4().substring(0, 8)}`;
  }

  static generateTransferId(prefix = 'transfer') {
    return `${prefix}_${uuidv4().substring(0, 8)}`;
  }

  static generateIdempotencyKey() {
    return uuidv4();
  }

  static buildWallet(overrides = {}) {
    return {
      wallet_id: overrides.wallet_id || this.generateWalletId(),
      balance: overrides.balance !== undefined ? overrides.balance : 10000,
      currency: overrides.currency || 'AED',
      ...overrides,
    };
  }

  static buildTransferRequest(overrides = {}) {
    return {
      source_wallet_id: overrides.source_wallet_id || this.generateWalletId('source'),
      destination_wallet_id: overrides.destination_wallet_id || this.generateWalletId('dest'),
      amount: overrides.amount !== undefined ? overrides.amount : 1000,
      currency: overrides.currency || 'AED',
      reference: overrides.reference || `invoice_${Date.now()}`,
      ...overrides,
    };
  }

  static buildMultipleWallets(count, baseBalance = 10000) {
    const wallets = [];
    for (let i = 0; i < count; i++) {
      wallets.push(this.buildWallet({
        wallet_id: `wallet_test_${i}_${uuidv4().substring(0, 8)}`,
        balance: baseBalance,
      }));
    }
    return wallets;
  }

  static buildTransferScenario(scenarioType = 'happy_path') {
    const scenarios = {
      happy_path: {
        sourceBalance: 10000,
        destBalance: 5000,
        transferAmount: 2500,
      },
      insufficient_balance: {
        sourceBalance: 1000,
        destBalance: 5000,
        transferAmount: 2500,
      },
      zero_amount: {
        sourceBalance: 10000,
        destBalance: 5000,
        transferAmount: 0,
      },
      negative_amount: {
        sourceBalance: 10000,
        destBalance: 5000,
        transferAmount: -100,
      },
      same_wallet: {
        sourceBalance: 10000,
        destBalance: 10000,
        transferAmount: 1000,
        sameWallet: true,
      },
      large_transfer: {
        sourceBalance: 1000000,
        destBalance: 500000,
        transferAmount: 500000,
      },
    };

    const scenario = scenarios[scenarioType] || scenarios.happy_path;
    const sourceWalletId = this.generateWalletId('source');
    const destWalletId = scenario.sameWallet ? sourceWalletId : this.generateWalletId('dest');

    return {
      sourceWallet: this.buildWallet({
        wallet_id: sourceWalletId,
        balance: scenario.sourceBalance,
      }),
      destWallet: this.buildWallet({
        wallet_id: destWalletId,
        balance: scenario.destBalance,
      }),
      transferRequest: this.buildTransferRequest({
        source_wallet_id: sourceWalletId,
        destination_wallet_id: destWalletId,
        amount: scenario.transferAmount,
      }),
      idempotencyKey: this.generateIdempotencyKey(),
    };
  }

  static buildInvalidTransferRequests() {
    return {
      missing_source: {
        destination_wallet_id: this.generateWalletId('dest'),
        amount: 1000,
        currency: 'AED',
      },
      missing_destination: {
        source_wallet_id: this.generateWalletId('source'),
        amount: 1000,
        currency: 'AED',
      },
      missing_amount: {
        source_wallet_id: this.generateWalletId('source'),
        destination_wallet_id: this.generateWalletId('dest'),
        currency: 'AED',
      },
      invalid_currency: {
        source_wallet_id: this.generateWalletId('source'),
        destination_wallet_id: this.generateWalletId('dest'),
        amount: 1000,
        currency: 'INVALID',
      },
      negative_amount: {
        source_wallet_id: this.generateWalletId('source'),
        destination_wallet_id: this.generateWalletId('dest'),
        amount: -100,
        currency: 'AED',
      },
      zero_amount: {
        source_wallet_id: this.generateWalletId('source'),
        destination_wallet_id: this.generateWalletId('dest'),
        amount: 0,
        currency: 'AED',
      },
    };
  }

  static buildConcurrentTransferScenario(walletBalance = 5000, transferAmount = 2000, concurrentCount = 3) {
    const sourceWalletId = this.generateWalletId('concurrent_source');
    const transfers = [];

    for (let i = 0; i < concurrentCount; i++) {
      transfers.push({
        transferRequest: this.buildTransferRequest({
          source_wallet_id: sourceWalletId,
          destination_wallet_id: this.generateWalletId(`concurrent_dest_${i}`),
          amount: transferAmount,
        }),
        idempotencyKey: this.generateIdempotencyKey(),
      });
    }

    return {
      sourceWallet: this.buildWallet({
        wallet_id: sourceWalletId,
        balance: walletBalance,
      }),
      transfers,
      expectedSuccessfulTransfers: Math.floor(walletBalance / transferAmount),
    };
  }

  static buildIdempotencyTestScenario() {
    const sourceWalletId = this.generateWalletId('idempotent_source');
    const destWalletId = this.generateWalletId('idempotent_dest');
    const idempotencyKey = this.generateIdempotencyKey();

    return {
      sourceWallet: this.buildWallet({
        wallet_id: sourceWalletId,
        balance: 10000,
      }),
      destWallet: this.buildWallet({
        wallet_id: destWalletId,
        balance: 5000,
      }),
      transferRequest: this.buildTransferRequest({
        source_wallet_id: sourceWalletId,
        destination_wallet_id: destWalletId,
        amount: 2500,
      }),
      idempotencyKey,
      modifiedTransferRequest: this.buildTransferRequest({
        source_wallet_id: sourceWalletId,
        destination_wallet_id: destWalletId,
        amount: 3500,
      }),
    };
  }
}

module.exports = TestDataBuilder;
