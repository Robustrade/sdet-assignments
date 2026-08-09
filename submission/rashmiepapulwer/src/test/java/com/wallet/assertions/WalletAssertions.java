package com.wallet.assertions;

import com.wallet.client.DatabaseVerificationClient;
import com.wallet.model.WalletBalance;
import org.assertj.core.api.Assertions;

import java.math.BigDecimal;

/**
 * Fluent assertions for verifying wallet balance state.
 *
 * Captures before/after balance snapshots to express assertions in a
 * readable, business-oriented style.
 *
 * Example:
 *
 * <pre>{@code
 * WalletBalance sourceBefore =
 *         WalletAssertions.snapshot(dbClient, sourceId);
 *
 * // Execute transfer
 *
 * WalletAssertions.assertThat(dbClient, sourceId)
 *         .balanceDecreasedBy(new BigDecimal("100.00"), sourceBefore);
 * }</pre>
 */

public class WalletAssertions {

        private final DatabaseVerificationClient dbClient;
        private final String walletId;
        private WalletBalance currentBalance;

        private WalletAssertions(DatabaseVerificationClient dbClient, String walletId) {
            this.dbClient = dbClient;
            this.walletId = walletId;
            this.currentBalance = dbClient.getWalletBalance(walletId);
        }

        public static WalletAssertions assertThat(DatabaseVerificationClient dbClient, String walletId) {
            return new WalletAssertions(dbClient, walletId);
        }

        public static WalletBalance snapshot(DatabaseVerificationClient dbClient, String walletId) {
            return dbClient.getWalletBalance(walletId);
        }

        // ─── Balance Assertions ───────────────────────────────────────────────────

        public WalletAssertions hasBalance(BigDecimal expected) {
            BigDecimal actual = currentBalance.getBalance();
            Assertions.assertThat(actual.stripTrailingZeros())
                    .as("Expected wallet %s balance = %s but got %s", walletId, expected, actual)
                    .isEqualTo(expected.stripTrailingZeros());
            return this;
        }

        public WalletAssertions hasBalanceGreaterThan(BigDecimal floor) {
            BigDecimal actual = currentBalance.getBalance();
            Assertions.assertThat(actual)
                    .as("Expected wallet %s balance > %s but got %s", walletId, floor, actual)
                    .isGreaterThan(floor);
            return this;
        }

        public WalletAssertions hasNonNegativeBalance() {
            BigDecimal actual = currentBalance.getBalance();
            Assertions.assertThat(actual)
                    .as("Wallet %s balance went negative: %s", walletId, actual)
                    .isGreaterThanOrEqualTo(BigDecimal.ZERO);
            return this;
        }

        /**
         * Verifies balance decreased by exactly `delta` compared to `before`.
         */
        public WalletAssertions balanceDecreasedBy(BigDecimal delta, WalletBalance before) {
            BigDecimal expectedBalance = before.getBalance().subtract(delta);
            BigDecimal actualBalance = currentBalance.getBalance();
            Assertions.assertThat(actualBalance.stripTrailingZeros())
                    .as("Expected wallet %s balance to decrease by %s (from %s to %s) but got %s",
                            walletId, delta, before.getBalance(), expectedBalance, actualBalance)
                    .isEqualTo(expectedBalance.stripTrailingZeros());
            return this;
        }

        /**
         * Verifies balance increased by exactly `delta` compared to `before`.
         */
        public WalletAssertions balanceIncreasedBy(BigDecimal delta, WalletBalance before) {
            BigDecimal expectedBalance = before.getBalance().add(delta);
            BigDecimal actualBalance = currentBalance.getBalance();
            Assertions.assertThat(actualBalance.stripTrailingZeros())
                    .as("Expected wallet %s balance to increase by %s (from %s to %s) but got %s",
                            walletId, delta, before.getBalance(), expectedBalance, actualBalance)
                    .isEqualTo(expectedBalance.stripTrailingZeros());
            return this;
        }

        /**
         * Balance conservation: sum of deltas across source and destination = 0.
         * Verifies no money was created or destroyed.
         */
        public static void assertBalanceConservation(WalletBalance sourceBefore, WalletBalance sourceAfter,
                                                     WalletBalance destBefore, WalletBalance destAfter) {
            BigDecimal sourceDelta = sourceAfter.getBalance().subtract(sourceBefore.getBalance());
            BigDecimal destDelta   = destAfter.getBalance().subtract(destBefore.getBalance());
            BigDecimal netChange   = sourceDelta.add(destDelta);

            Assertions.assertThat(netChange.stripTrailingZeros())
                    .as("Balance conservation violated: source delta=%s, dest delta=%s, net=%s (should be 0). " +
                                    "Money was created or destroyed.",
                            sourceDelta, destDelta, netChange)
                    .isEqualTo(BigDecimal.ZERO.stripTrailingZeros());
        }

        /**
         * Verifies balance did not change compared to `before` (idempotency / failure scenarios).
         */
        public WalletAssertions balanceUnchanged(WalletBalance before) {
            BigDecimal actualBalance = currentBalance.getBalance();
            Assertions.assertThat(actualBalance.stripTrailingZeros())
                    .as("Expected wallet %s balance to remain %s but got %s",
                            walletId, before.getBalance(), actualBalance)
                    .isEqualTo(before.getBalance().stripTrailingZeros());
            return this;
        }

        /**
         * Refreshes the cached balance snapshot from DB (for polling scenarios).
         */
        public WalletAssertions refresh() {
            this.currentBalance = dbClient.getWalletBalance(walletId);
            return this;
        }

        public WalletBalance currentSnapshot() {
            return currentBalance;
        }
    }