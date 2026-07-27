package com.kulu.sdet.support.builders;

import java.util.UUID;

/** Small helper for generating fresh idempotency keys per test. */
public final class IdemKey {
  private IdemKey() {}

  public static String fresh() {
    return UUID.randomUUID().toString();
  }
}
