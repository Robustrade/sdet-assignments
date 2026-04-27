package com.wallet.client;

import com.wallet.config.TestConfig;
import com.wallet.model.TransferRequest;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;

import static io.restassured.RestAssured.given;

/**
 * Thin wrapper around RestAssured for the /transfers endpoint.
 * Keeps all HTTP transport details out of test methods.
 */
public class TransferClient {

    private final String baseUrl;

    public TransferClient() {
        this(TestConfig.SERVICE_BASE_URL);
    }

    public TransferClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * POST /transfers — create a new transfer.
     *
     * @param request        the transfer payload
     * @param idempotencyKey optional Idempotency-Key header value; null to omit
     * @return the raw RestAssured {@link Response} — callers assert on it
     */
    public Response createTransfer(TransferRequest request, String idempotencyKey) {
        RequestSpecification spec = baseSpec().body(request);
        if (idempotencyKey != null) {
            spec = spec.header("Idempotency-Key", idempotencyKey);
        }
        return spec.post(baseUrl + "/transfers");
    }

    /**
     * GET /transfers/{id}
     */
    public Response getTransfer(String transferId) {
        return baseSpec().get(baseUrl + "/transfers/" + transferId);
    }

    // ─────────────────────────────────────────
    //  Private
    // ─────────────────────────────────────────

    private RequestSpecification baseSpec() {
        return given()
                .contentType("application/json")
                .accept("application/json")
                .log().ifValidationFails();
    }
}

