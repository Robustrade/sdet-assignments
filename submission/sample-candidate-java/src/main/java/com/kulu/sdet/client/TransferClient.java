package com.wallet.client;

import com.wallet.models.TransferRequest;
import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.Response;

public class TransferClient {

    private static final String BASE_URL = "http://localhost:8080"; // Can be moved to ConfigReader

    /**
     * POST /transfers
     * Executes the core wallet transfer operation.
     */
    public Response postTransfer(TransferRequest payload, String idempotencyKey) {
        return RestAssured.given()
                .baseUri(BASE_URL)
                .contentType(ContentType.JSON)
                .header("Idempotency-Key", idempotencyKey) // Required Header mapped here
                .body(payload)                             // POJO automatically converted to JSON
                .post("/transfers");
    }

    /**
     * GET /transfers/{transfer_id}
     * Retrieves the status of a specific transfer.
     */
    public Response getTransferDetails(String transferId) {
        return RestAssured.given()
                .baseUri(BASE_URL)
                .pathParam("transfer_id", transferId)
                .get("/transfers/{transfer_id}");
    }
}