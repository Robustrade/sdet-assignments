package com.wallet.fixture.model;

/** A persisted wallet row, returned by GET /wallets/{wallet_id}. */
public record WalletRecord(String walletId, String currency, long balance) {}
