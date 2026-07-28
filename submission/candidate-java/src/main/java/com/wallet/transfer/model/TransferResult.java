package com.wallet.transfer.model;

import com.wallet.transfer.dto.TransferResponse;
import java.util.Optional;

public class TransferResult {
  private final boolean success;
  private final Optional<TransferResponse> response;
  private final Optional<TransferErrorCode> errorCode;

  private TransferResult(
      boolean success, Optional<TransferResponse> response, Optional<TransferErrorCode> errorCode) {
    this.success = success;
    this.response = response;
    this.errorCode = errorCode;
  }

  public static TransferResult success(TransferResponse response) {
    return new TransferResult(true, Optional.of(response), Optional.empty());
  }

  public static TransferResult failure(TransferErrorCode errorCode) {
    return new TransferResult(false, Optional.empty(), Optional.of(errorCode));
  }

  public boolean isSuccess() {
    return success;
  }

  public Optional<TransferResponse> getResponse() {
    return response;
  }

  public Optional<TransferErrorCode> getErrorCode() {
    return errorCode;
  }
}
