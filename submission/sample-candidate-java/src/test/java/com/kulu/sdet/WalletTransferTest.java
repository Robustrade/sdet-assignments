package com.kulu.sdet;

import com.kulu.sdet.client.TransferClient;
import com.kulu.sdet.db.WalletDB;
import com.kulu.sdet.model.TransferRequestBody;
import com.kulu.sdet.model.TransferResponseBody;
import org.testng.Assert;
import org.testng.annotations.Test;

import java.util.UUID;

import static org.testng.Assert.*;

public class WalletTransferTest extends BaseTest {

    private final TransferClient transferClient = new TransferClient();
    private final WalletDB walletDB = new WalletDB();

    @Test(description = "Verify Wallet-to-wallet transfer with a valid request")
    public void shouldCompleteTransferWhenRequestIsValid() {
        // Arrange
        String senderId = "wallet_001";
        String receiverId = "wallet_002";
        long amount = 200;
        String currency = "AED";
        String reference = "invoice_123";
        String idempotencyKey = UUID.randomUUID().toString();

        long senderBalanceBefore = walletDB.getBalance(senderId);
        long receiverBalanceBefore = walletDB.getBalance(receiverId);

        TransferRequestBody requestBody = TransferRequestBody.builder()
                .sourceWalletId(senderId)
                .destinationWalletId(receiverId)
                .amount(amount)
                .currency(currency)
                .reference(reference)
                .build();

        // Act
        TransferResponseBody response = transferClient.create(requestBody, idempotencyKey);

        // Assert - API response
        assertEquals(response.getStatusCode(), 201, "expected 201 Created");
        response.assertCreated(requestBody, idempotencyKey);

        // Assert - DB
        long senderBalanceAfter = walletDB.getBalance(senderId);
        long receiverBalanceAfter = walletDB.getBalance(receiverId);
        assertEquals(senderBalanceBefore - senderBalanceAfter, amount);
        assertEquals(receiverBalanceAfter - receiverBalanceBefore, amount);
    }

    @Test(description = "Verify wallet-to-wallet transfer with same Idempotency-Key but different payload")
    public void shouldRejectTransferForSameIdempotencyKeyAndDifferentPayload() {
        // 1. First Transaction
        String senderId = "wallet_001";
        String receiverId = "wallet_002";
        long amount = 200L;
        String currency = "AED";
        String idempotencyKey = UUID.randomUUID().toString();

        TransferRequestBody firstReq = TransferRequestBody.builder()
                .sourceWalletId(senderId)
                .destinationWalletId(receiverId)
                .amount(amount)
                .currency(currency)
                .reference("first-payload")
                .build();
        TransferResponseBody firstTransactionResponseBody = transferClient.create(firstReq, idempotencyKey);
        assertEquals(firstTransactionResponseBody.getStatusCode(), 201, "first transfer should be created");
        long senderBalanceBefore = walletDB.getBalance(senderId);

        // 2. Second Transaction with same Idempotency-Key but different payload
        TransferRequestBody secondReq = TransferRequestBody.builder()
                .sourceWalletId(senderId)
                .destinationWalletId(receiverId)
                .amount(500L)
                .currency("INR")
                .reference("second-payload")
                .build();

        TransferResponseBody secondTransactionRes = transferClient.create(secondReq, idempotencyKey);
        long senderBalanceAfter = walletDB.getBalance(senderId);

        assertEquals(secondTransactionRes.getStatusCode(), 409, "should return 409 status code");
        assertEquals(senderBalanceBefore, senderBalanceAfter, "balance should not be updated");
    }

    @Test(description = "Verify wallet-to-wallet transfer for same Idempotency-Key and same payload")
    public void shouldRejectTransferForSameIdempotencyKeyAndSamePayload() {
        // 1. First Transaction
        String senderId = "wallet_001";
        String receiverId = "wallet_002";
        long amount = 200L;
        String currency = "AED";
        String idempotencyKey = UUID.randomUUID().toString();

        TransferRequestBody transferRequestBody = TransferRequestBody.builder()
                .sourceWalletId(senderId)
                .destinationWalletId(receiverId)
                .amount(amount)
                .currency(currency)
                .reference("duplicate-payment")
                .build();
        TransferResponseBody firstTransactionResponseBody = transferClient.create(transferRequestBody, idempotencyKey);
        assertEquals(firstTransactionResponseBody.getStatusCode(), 201, "first transfer should be created");
        long senderBalanceBefore = walletDB.getBalance(senderId);
        long receiverBalanceBefore = walletDB.getBalance(receiverId);

        // 2. Duplicate request
        TransferResponseBody responseBody = transferClient.create(transferRequestBody, idempotencyKey);
        Assert.assertEquals(responseBody.getStatusCode(), 200);

        // DB Assertion
        long senderBalanceAfter = walletDB.getBalance(senderId);
        long receiverBalanceAfter = walletDB.getBalance(receiverId);
        assertEquals(senderBalanceBefore, senderBalanceAfter);
        assertEquals(receiverBalanceBefore, receiverBalanceAfter);
    }

}