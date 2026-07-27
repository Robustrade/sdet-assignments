package com.kulu.sdet.support;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Domain-level invariant assertions. These are the properties that must always hold for a wallet
 * transfer system regardless of API surface details.
 */
public final class Invariants {

  private Invariants() {}

  /** Balances must sum to a conserved total across the source/destination pair. */
  public static void assertBalanceConservation(
      long sourceBefore, long destBefore, long sourceAfter, long destAfter) {
    assertThat(sourceBefore + destBefore)
        .as("total balance of the wallet pair is conserved")
        .isEqualTo(sourceAfter + destAfter);
  }

  /** Source lost exactly {@code amount}; destination gained exactly {@code amount}. */
  public static void assertExactDelta(
      long sourceBefore, long destBefore, long sourceAfter, long destAfter, long amount) {
    assertThat(sourceBefore - sourceAfter)
        .as("source wallet debited exactly the transfer amount")
        .isEqualTo(amount);
    assertThat(destAfter - destBefore)
        .as("destination wallet credited exactly the transfer amount")
        .isEqualTo(amount);
  }

  /** Balances are unchanged — used for rejected/failed transfer assertions. */
  public static void assertBalancesUnchanged(
      long sourceBefore, long destBefore, long sourceAfter, long destAfter) {
    assertThat(sourceAfter)
        .as("source balance must be unchanged after a rejected transfer")
        .isEqualTo(sourceBefore);
    assertThat(destAfter)
        .as("destination balance must be unchanged after a rejected transfer")
        .isEqualTo(destBefore);
  }
}
