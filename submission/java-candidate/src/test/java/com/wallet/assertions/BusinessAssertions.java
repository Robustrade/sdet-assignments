package com.wallet.assertions;

import com.wallet.db.WalletRepository;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * High-level business invariant assertions.
 * Expresses economic correctness — e.g. conservation of funds.
 */
public class BusinessAssertions {

    private final WalletRepository wallets;

    public BusinessAssertions(WalletRepository wallets) {
        this.wallets = wallets;
    }

    /**
     * Asserts that after a successful transfer:
     *  - source was debited exactly once
     *  - destination was credited exactly once
     *  - no money was created or destroyed (conservation)
     */
    public BusinessAssertions verifySuccessfulTransfer(String sourceId,
                                                        String destId,
                                                        BigDecimal transferAmount,
                                                        BigDecimal sourceBalanceBefore,
                                                        BigDecimal destBalanceBefore) {
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

        // Conservation: total across both wallets must not change
        BigDecimal totalBefore = sourceBalanceBefore.add(destBalanceBefore);
        BigDecimal totalAfter  = sourceNow.add(destNow);
        assertThat(totalAfter)
                .as("Total balance across source and destination must be conserved")
                .isEqualByComparingTo(totalBefore);

        return this;
    }

    /**
     * Asserts that a rejected / failed transfer left both wallets unchanged.
     */
    public BusinessAssertions verifyNoBalanceMutation(String sourceId,
                                                       String destId,
                                                       BigDecimal sourceBalanceBefore,
                                                       BigDecimal destBalanceBefore) {
        BigDecimal sourceNow = wallets.getBalance(sourceId);
        BigDecimal destNow   = wallets.getBalance(destId);

        assertThat(sourceNow)
                .as("Source wallet [%s] balance must be unchanged after rejection", sourceId)
                .isEqualByComparingTo(sourceBalanceBefore);

        assertThat(destNow)
                .as("Destination wallet [%s] balance must be unchanged after rejection", destId)
                .isEqualByComparingTo(destBalanceBefore);

        return this;
    }

    /**
     * After N concurrent transfer attempts competing for insufficient total balance,
     * verifies that the combined balance change does not exceed the expected debit.
     */
    public BusinessAssertions verifyNoOverdraft(String sourceId, BigDecimal initialBalance) {
        BigDecimal currentBalance = wallets.getBalance(sourceId);
        assertThat(currentBalance)
                .as("Wallet [%s] must not have a negative balance (overdraft)", sourceId)
                .isGreaterThanOrEqualTo(BigDecimal.ZERO);
        assertThat(currentBalance)
                .as("Wallet [%s] balance must not exceed initial balance %s", sourceId, initialBalance)
                .isLessThanOrEqualTo(initialBalance);
        return this;
    }
}

