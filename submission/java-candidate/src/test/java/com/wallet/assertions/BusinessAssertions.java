     * After N concurrent transfer attempts competing for insufficient total balance,
     * verifies that the combined balance change does not exceed the expected debit.
     * Asserts that a rejected / failed transfer left both wallets unchanged.
     * Asserts that after a successful transfer:
     *  - source was debited exactly once
     *  - destination was credited exactly once
     *  - no money was created or destroyed (conservation)
 * High-level business invariant assertions.
 * Expresses economic correctness — e.g. conservation of funds.
package com.wallet.assertions;

import com.wallet.db.WalletRepository;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Business-level assertions — checks that money moved correctly (or didn't move at all).
 * Basically answers: "did the transfer do what it was supposed to financially?"
 */
public class BusinessAssertions {

    private final WalletRepository wallets;

    public BusinessAssertions(WalletRepository wallets) {
        this.wallets = wallets;
    }

    /**
     * Checks that source got debited and dest got credited by exactly the right amount.
     * Also verifies conservation — total money across both wallets must not change.
     */
    public BusinessAssertions verifySuccessfulTransfer(String sourceId,
                                                        String destId,
                                                        BigDecimal transferAmount,
                                                        BigDecimal sourceBalanceBefore,
                                                        BigDecimal destBalanceBefore) {
        // fetch current balances from DB
        BigDecimal sourceNow = wallets.getBalance(sourceId);
        BigDecimal destNow   = wallets.getBalance(destId);

        BigDecimal expectedSource = sourceBalanceBefore.subtract(transferAmount);
        BigDecimal expectedDest   = destBalanceBefore.add(transferAmount);

        assertThat(sourceNow)
                .as("Source wallet [%s] should be debited by %s", sourceId, transferAmount)
                .isEqualByComparingTo(expectedSource);

        assertThat(destNow)
                .as("Destination wallet [%s] should be credited by %s", destId, transferAmount)
                .isEqualByComparingTo(expectedDest);

        // money should not appear from nowhere or vanish — total must be the same
        BigDecimal totalBefore = sourceBalanceBefore.add(destBalanceBefore);
        BigDecimal totalAfter  = sourceNow.add(destNow);
        assertThat(totalAfter)
                .as("Total balance across source and destination must be conserved")
                .isEqualByComparingTo(totalBefore);

        return this;
    }

    /**
     * When a transfer fails, neither wallet should be touched.
     * Use this after a 422 or 400 to confirm no side effects.
     */
    public BusinessAssertions verifyNoBalanceMutation(String sourceId,
                                                       String destId,
                                                       BigDecimal sourceBalanceBefore,
                                                       BigDecimal destBalanceBefore) {
        BigDecimal sourceNow = wallets.getBalance(sourceId);
        BigDecimal destNow   = wallets.getBalance(destId);

        // neither side should have changed — a failed transfer must be a no-op
        assertThat(sourceNow)
                .as("Source wallet [%s] balance must be unchanged after rejection", sourceId)
                .isEqualByComparingTo(sourceBalanceBefore);

        assertThat(destNow)
                .as("Destination wallet [%s] balance must be unchanged after rejection", destId)
                .isEqualByComparingTo(destBalanceBefore);

        return this;
    }

    /**
     * Makes sure the wallet didn't go negative and didn't somehow end up with more than it started.
     * Mainly used after concurrent tests where the locking could theoretically go wrong.
     */
    public BusinessAssertions verifyNoOverdraft(String sourceId, BigDecimal initialBalance) {
        BigDecimal currentBalance = wallets.getBalance(sourceId);

        // balance must always be >= 0 — never go into the red
        assertThat(currentBalance)
                .as("Wallet [%s] must not have a negative balance (overdraft)", sourceId)
                .isGreaterThanOrEqualTo(BigDecimal.ZERO);

        // also sanity check it didn't somehow go above the starting balance
        assertThat(currentBalance)
                .as("Wallet [%s] balance must not exceed initial balance %s", sourceId, initialBalance)
                .isLessThanOrEqualTo(initialBalance);
        return this;
    }
}

