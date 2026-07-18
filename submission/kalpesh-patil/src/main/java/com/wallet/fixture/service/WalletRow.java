package com.wallet.fixture.service;

/** Internal snapshot of a wallet row read during transfer processing. */
record WalletRow(String walletId, String currency, long balance) {}
