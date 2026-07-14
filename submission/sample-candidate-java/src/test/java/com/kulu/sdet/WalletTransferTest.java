package com.kulu.sdet;

import com.kulu.sdet.client.TransferClient;
import com.kulu.sdet.client.WalletClient;
import com.kulu.sdet.db.WalletDB;
import com.kulu.sdet.model.ErrorResponseBody;
import com.kulu.sdet.model.TransferRequestBody;
import com.kulu.sdet.model.TransferResponseBody;
import org.testng.Assert;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

import java.util.List;
import java.util.UUID;

import static org.testng.Assert.*;

public class WalletTransferTest extends BaseTest {

    private final TransferClient transferClient = new TransferClient();
    private final WalletDB walletDB = new WalletDB();
    private final WalletClient walletClient = new WalletClient();

    private static final String SENDER_ID = "wallet_001";
    private static final String RECEIVER_ID = "wallet_002";
    private static final String CURRENCY = "AED";
    private static final long AMOUNT = 200L;

    private TransferRequestBody transferRequestBody;
    private String idempotencyKey;

    @BeforeMethod(alwaysRun = true)
    public void setUpTestData() {
        transferRequestBody = TransferRequestBody.builder()
                .sourceWalletId(SENDER_ID)
                .destinationWalletId(RECEIVER_ID)
                .currency(CURRENCY)
                .amount(AMOUNT)
                .reference("valid-request")
                .build();

        idempotencyKey = UUID.randomUUID().toString();
    }

    @Test(description = "Verify Wallet-to-wallet transfer with a valid request")
    public void shouldCompleteTransferWhenRequestIsValid() {
        long senderBalanceBefore = walletDB.getBalance(SENDER_ID);
        long receiverBalanceBefore = walletDB.getBalance(RECEIVER_ID);

        TransferResponseBody response = transferClient.create(transferRequestBody, idempotencyKey);

        // Assert - API response
        assertEquals(response.getStatusCode(), 201, "expected 201 Created");
        response.assertCreated(transferRequestBody, idempotencyKey);

        // Assert - DB
        long senderBalanceAfter = walletDB.getBalance(SENDER_ID);
        long receiverBalanceAfter = walletDB.getBalance(RECEIVER_ID);
        assertEquals(senderBalanceBefore - senderBalanceAfter, AMOUNT);
        assertEquals(receiverBalanceAfter - receiverBalanceBefore, AMOUNT);
    }

    @Test(description = "Verify wallet-to-wallet transfer with same Idempotency-Key but different payload")
    public void shouldRejectTransferForSameIdempotencyKeyAndDifferentPayload() {
        // 1. First Transaction
        TransferResponseBody firstTransactionResponseBody = transferClient.create(transferRequestBody, idempotencyKey);
        assertEquals(firstTransactionResponseBody.getStatusCode(), 201,
                "first transfer should be created");
        long senderBalanceBefore = walletDB.getBalance(SENDER_ID);

        // 2. Second Transaction with same Idempotency-Key but different payload
        TransferRequestBody secondReq = TransferRequestBody.builder()
                .sourceWalletId(SENDER_ID)
                .destinationWalletId(RECEIVER_ID)
                .amount(500L)
                .currency("INR")
                .reference("second-payload")
                .build();

        TransferResponseBody secondTransactionRes = transferClient.create(secondReq, idempotencyKey);
        long senderBalanceAfter = walletDB.getBalance(SENDER_ID);

        assertEquals(secondTransactionRes.getStatusCode(), 409, "should return 409 status code");
        assertEquals(senderBalanceBefore, senderBalanceAfter, "balance should not be updated");
    }

    @Test(description = "Verify wallet-to-wallet transfer for same Idempotency-Key and same payload")
    public void shouldRejectTransferForSameIdempotencyKeyAndSamePayload() {
        // 1. First Transaction
        TransferResponseBody firstTransactionResponseBody = transferClient.create(transferRequestBody, idempotencyKey);
        assertEquals(firstTransactionResponseBody.getStatusCode(), 201,
                "first transfer should be created");
        long senderBalanceBefore = walletDB.getBalance(SENDER_ID);
        long receiverBalanceBefore = walletDB.getBalance(RECEIVER_ID);

        // 2. Duplicate request
        TransferResponseBody responseBody = transferClient.create(transferRequestBody, idempotencyKey);
        Assert.assertEquals(responseBody.getStatusCode(), 200);

        // DB Assertion
        long senderBalanceAfter = walletDB.getBalance(SENDER_ID);
        long receiverBalanceAfter = walletDB.getBalance(RECEIVER_ID);
        assertEquals(senderBalanceBefore, senderBalanceAfter);
        assertEquals(receiverBalanceBefore, receiverBalanceAfter);
    }

    @Test(description = "Verify created transfer is fetched by id")
    public void shouldFetchTransfer() {
        // 1. Create transaction
        TransferResponseBody createdRes = transferClient.create(transferRequestBody, idempotencyKey);
        assertEquals(createdRes.getStatusCode(), 201);

        // 2. Fetch created transaction
        TransferResponseBody fetchedRes = transferClient.getById(createdRes.getId());

        assertEquals(fetchedRes.getStatusCode(), 200);
        assertEquals(fetchedRes.getId(), createdRes.getId());
        assertEquals(fetchedRes.getSourceWalletId(), createdRes.getSourceWalletId());
        assertEquals(fetchedRes.getDestinationWalletId(), createdRes.getDestinationWalletId());
        assertEquals(fetchedRes.getAmount(), createdRes.getAmount());
        assertEquals(fetchedRes.getCurrency(), createdRes.getCurrency());
        assertEquals(fetchedRes.getReference(), createdRes.getReference());
        assertEquals(fetchedRes.getStatus(), createdRes.getStatus());
        assertEquals(fetchedRes.getIdempotencyKey(), createdRes.getIdempotencyKey());
        assertNotNull(fetchedRes.getCreatedAt());
    }

    @Test(description = "Verify Two concurrent transfer request at the same time and available balance is only for one transfer")
    public void shouldAllowOnlyOneTransferWhenBalanceCoversOne() {
        long senderBalanceBefore = walletDB.getBalance(SENDER_ID);
        long receiverBalanceBefore = walletDB.getBalance(RECEIVER_ID);
        long amount = senderBalanceBefore;

        TransferRequestBody req1 = TransferRequestBody.builder()
                .sourceWalletId(SENDER_ID)
                .destinationWalletId(RECEIVER_ID)
                .currency(CURRENCY)
                .amount(amount)
                .reference("thread-1")
                .build();

        TransferRequestBody req2 = TransferRequestBody.builder()
                .sourceWalletId(SENDER_ID)
                .destinationWalletId(RECEIVER_ID)
                .currency(CURRENCY)
                .amount(amount)
                .reference("thread-2")
                .build();

        List<TransferRequestBody> requests = List.of(req1, req2);

        List<Integer> statusCodeList = requests.parallelStream()
                .map(req -> transferClient.create(req, UUID.randomUUID().toString()).getStatusCode())
                .toList();

        long successCount = statusCodeList.stream()
                .filter(statusCode -> statusCode == 201)
                .count();

        assertEquals(successCount, 1, "Only one transfer should success");

        // DB Assertions
        long senderBalanceAfter = walletDB.getBalance(SENDER_ID);
        long receiverBalanceAfter = walletDB.getBalance(RECEIVER_ID);

        assertEquals(senderBalanceBefore - senderBalanceAfter, amount);
        assertEquals(receiverBalanceAfter - receiverBalanceBefore, amount);
        assertTrue(senderBalanceAfter >= 0, "balance should not be negative");
    }

    @Test(description = "Verify concurrent duplicate requests with the same Idempotency-Key but creates exactly one transfers")
    public void shouldCreateOnlyOneTransferForConcurrentSameKeyRequests() {
        long senderBalanceBefore = walletDB.getBalance(SENDER_ID);
        long amount = 100L;
        transferRequestBody.setAmount(amount);

        // Sends 5 request in parallel
        List<TransferRequestBody> requests = List.of(transferRequestBody, transferRequestBody, transferRequestBody,
                transferRequestBody, transferRequestBody);

        List<Integer> statusCodeList = requests.parallelStream()
                .map(req -> transferClient.create(req, idempotencyKey).getStatusCode())
                .toList();

        long successCount = statusCodeList.stream()
                .filter(statusCode -> statusCode == 201)
                .count();

        assertEquals(successCount, 1, "exactly one request should be passed");

        // DB Assertions
        long senderBalanceAfter = walletDB.getBalance(SENDER_ID);
        assertEquals(senderBalanceBefore - senderBalanceAfter, amount);

        int rowCount = walletDB.countTransfersByIdempotencyKey(idempotencyKey);
        assertEquals(rowCount, 1);
    }

    @Test(description = "Verify wallet-to-wallet transfer is rejected for amount greater than available balance")
    public void shouldRejectTransactionForInsufficientBalance() {
        long senderBalanceBefore = walletDB.getBalance(SENDER_ID);
        transferRequestBody.setAmount(senderBalanceBefore + 1);

        ErrorResponseBody responseBody = transferClient.createExpectingError(transferRequestBody, idempotencyKey);

        assertEquals(responseBody.getStatusCode(), 422);
        assertEquals(responseBody.getMessage(), "insufficient balance");
    }

    @Test(description = "Verify wallet-to-wallet transfer for zero amount")
    public void shouldRejectTransactionForZeroAmount() {
        transferRequestBody.setAmount(0L);

        TransferResponseBody responseBody = transferClient.create(transferRequestBody, idempotencyKey);

        assertEquals(responseBody.getStatusCode(), 422);
        assertEquals(responseBody.getError(), "amount must be positive");
    }

    @Test(description = "Verify wallet-to-wallet transfer is rejected for negative amount")
    public void shouldRejectTransactionForNegativeAmount() {
        transferRequestBody.setAmount(-100L);

        ErrorResponseBody responseBody = transferClient.createExpectingError(transferRequestBody, idempotencyKey);

        assertEquals(responseBody.getStatusCode(), 422);
        assertEquals(responseBody.getError(), "amount must be positive");
    }

    @Test(description = "Verify wallet-to-wallet transfer is rejected for an unsupported currency")
    public void shouldRejectTransactionForInvalidCurrency() {
        transferRequestBody.setCurrency("XYZ");

        ErrorResponseBody responseBody = transferClient.createExpectingError(transferRequestBody, idempotencyKey);

        assertEquals(responseBody.getStatusCode(), 422);
        assertEquals(responseBody.getMessage(), "invalid currency");
    }

}