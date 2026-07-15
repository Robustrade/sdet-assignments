package com.kulu.sdet.domain;

public enum TransferStatus {
  COMPLETED,
  FAILED;

  public String wire() {
    return name().toLowerCase();
  }
}
