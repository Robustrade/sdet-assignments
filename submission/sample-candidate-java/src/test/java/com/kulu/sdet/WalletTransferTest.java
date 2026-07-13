package com.kulu.sdet;

import com.kulu.sdet.client.TransferClient;
import com.kulu.sdet.client.WalletClient;
import com.kulu.sdet.model.TransferRequestBody;
import com.kulu.sdet.model.TransferResponseBody;
import io.restassured.http.ContentType;
import org.testng.annotations.Test;

import java.util.UUID;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.testng.Assert.*;

public class WalletTransferTest extends BaseTest {

    private final TransferClient transferClient = new TransferClient();
    private final WalletClient walletClient = new WalletClient();

    @Test
    void testHappyPathTransfer() {
        String requestBody = """
                {
                    "source_wallet_id": "wallet_001",
                    "destination_wallet_id": "wallet_002",
                    "amount": 2500,
                    "currency": "AED",
                    "reference": "invoice_123"
                }
                """;

        given()
                .contentType(ContentType.JSON)
                .header("Idempotency-Key", "test-key-123")
                .body(requestBody)
                .when()
                .post("/transfers")
                .then()
                .statusCode(201)
                .body("status", equalTo("completed"));
    }

    // Add more tests for validation, idempotency, etc.

    @Test(description = "Verify wallet to wallet transfer for valid request")
    public void shouldCompleteTransferWhenRequestIsValid() {
        // Arrange
        String senderId = "wallet_001";
        String receiverId = "wallet_002";
        long amount = 200L;
        String idempotencyKey = UUID.randomUUID().toString();

        long senderBalanceBefore = walletClient.getById(senderId).getBalance();
        long receiverBalanceBefore = walletClient.getById(receiverId).getBalance();

        TransferRequestBody requestBody = TransferRequestBody.builder()
                .sourceWalletId(senderId)
                .destinationWalletId(receiverId)
                .amount(amount)
                .currency("AED")
                .reference("invoice_123")
                .build();

        // Act
        TransferResponseBody response = transferClient.create(requestBody, idempotencyKey);

        // Assert
        assertEquals(response.getStatusCode(), 201, "expected 201 Created");
        response.assertCreated(requestBody, idempotencyKey);

        TransferResponseBody fetchedTransferResponse = transferClient.getById(response.getId());
        assertEquals(fetchedTransferResponse.getStatusCode(), 200, "transfer should be retrievable");

        long senderBalanceAfter = walletClient.getById(senderId).getBalance();
        long receiverBalanceAfter = walletClient.getById(receiverId).getBalance();
        assertEquals(senderBalanceAfter, senderBalanceBefore - amount);
        assertEquals(receiverBalanceAfter, receiverBalanceBefore + amount);
    }

}