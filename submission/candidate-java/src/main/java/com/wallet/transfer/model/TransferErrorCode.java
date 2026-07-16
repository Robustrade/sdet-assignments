package com.wallet.transfer.model;

public enum TransferErrorCode {
  INVALID_REQUEST("INVALID_REQUEST", "Invalid transfer request"),
  WALLET_NOT_FOUND("WALLET_NOT_FOUND", "Wallet not found"),
  SAME_WALLET("SAME_WALLET", "Source and destination wallets cannot be the same"),
  INSUFFICIENT_BALANCE("INSUFFICIENT_BALANCE", "Insufficient balance in source wallet"),
  INVALID_AMOUNT("INVALID_AMOUNT", "Amount must be greater than zero"),
  INVALID_CURRENCY("INVALID_CURRENCY", "Invalid currency"),
  IDEMPOTENCY_KEY_CONFLICT(
      "IDEMPOTENCY_KEY_CONFLICT", "Idempotency key already used with different payload"),
  TRANSFER_NOT_FOUND("TRANSFER_NOT_FOUND", "Transfer not found"),
  INTERNAL_ERROR("INTERNAL_ERROR", "Internal server error");

  private final String code;
  private final String message;

  TransferErrorCode(String code, String message) {
    this.code = code;
    this.message = message;
  }

  public String code() {
    return code;
  }

  public String message() {
    return message;
  }
}
