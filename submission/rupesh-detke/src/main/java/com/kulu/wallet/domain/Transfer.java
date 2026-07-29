package com.kulu.wallet.domain;

import java.time.Instant;

public record Transfer(
    String id,
    String sourceWalletId,
    String destinationWalletId,
    long amount,
    String currency,
    String reference,
    TransferStatus status,
    Instant createdAt) {}
