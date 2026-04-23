package com.kulu.sdet;

import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

public class WalletTransferTest {

    @BeforeEach
    void setUp() {
        RestAssured.baseURI = "http://localhost:8080"; // Adjust as needed
    }

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
}