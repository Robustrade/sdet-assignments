package com.wallet.fixture;

import com.wallet.model.TransferRequest;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Factory for building TransferRequest objects for test scenarios.
 *
 * Provides named constructors for each scenario so test code reads as:
 *   TransferRequestBuilder.validTransfer(sourceId, destId)
 *   TransferRequestBuilder.withInsufficientAmount(sourceId, destId)
 */
public final class TransferRequestBuilder {

    private TransferRequestBuilder() {}

    // ─── Valid / Happy Path ───────────────────────────────────────────────────

    public static TransferRequest validTransfer(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .reference("test-ref-" + UUID.randomUUID())
                .build();
    }

    public static TransferRequest validTransfer(String sourceId, String destId,
                                                BigDecimal amount, String currency) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(amount)
                .currency(currency)
                .reference("test-ref-" + UUID.randomUUID())
                .build();
    }

    public static TransferRequest validTransferWithReference(String sourceId, String destId,
                                                              String reference) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("50.00"))
                .currency("USD")
                .reference(reference)
                .build();
    }

    // ─── Insufficient Balance ─────────────────────────────────────────────────

    public static TransferRequest exceedingBalance(String sourceId, String destId,
                                                    BigDecimal sourceBalance) {
        BigDecimal tooMuch = sourceBalance.add(new BigDecimal("0.01"));
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(tooMuch)
                .currency("USD")
                .reference("test-exceed-" + UUID.randomUUID())
                .build();
    }

    // ─── Validation Failure Scenarios ─────────────────────────────────────────

    public static TransferRequest missingSourceWallet(String destId) {
        return TransferRequest.builder()
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .build();
    }

    public static TransferRequest missingDestinationWallet(String sourceId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .build();
    }

    public static TransferRequest missingAmount(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .currency("USD")
                .build();
    }

    public static TransferRequest zeroAmount(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(BigDecimal.ZERO)
                .currency("USD")
                .build();
    }

    public static TransferRequest negativeAmount(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("-50.00"))
                .currency("USD")
                .build();
    }

    public static TransferRequest missingCurrency(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .build();
    }

    public static TransferRequest invalidCurrencyCode(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .currency("INVALID")
                .build();
    }

    public static TransferRequest lowercaseCurrency(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .currency("usd")
                .build();
    }

    public static TransferRequest sameSourceAndDestination(String walletId) {
        return TransferRequest.builder()
                .sourceWalletId(walletId)
                .destinationWalletId(walletId)
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .build();
    }

    public static TransferRequest nonExistentSourceWallet(String destId) {
        return TransferRequest.builder()
                .sourceWalletId(UUID.randomUUID().toString())
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .build();
    }

    public static TransferRequest nonExistentDestinationWallet(String sourceId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(UUID.randomUUID().toString())
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .build();
    }

    public static TransferRequest invalidWalletIdFormat(String destId) {
        return TransferRequest.builder()
                .sourceWalletId("not-a-uuid")
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .currency("USD")
                .build();
    }

    // ─── Currency mismatch ────────────────────────────────────────────────────

    public static TransferRequest currencyMismatch(String sourceId, String destId,
                                                     String walletCurrency, String requestCurrency) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.00"))
                .currency(requestCurrency)
                .build();
    }

    // ─── Precision / Edge amounts ─────────────────────────────────────────────

    public static TransferRequest minimumAmount(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("0.01"))
                .currency("USD")
                .build();
    }

    public static TransferRequest highPrecisionAmount(String sourceId, String destId) {
        return TransferRequest.builder()
                .sourceWalletId(sourceId)
                .destinationWalletId(destId)
                .amount(new BigDecimal("100.12345"))  // more than 4 decimal places
                .currency("USD")
                .build();
    }
}
