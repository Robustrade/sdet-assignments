package com.wallet.client;

import com.wallet.config.TestConfig;
import com.wallet.model.TransferRequest;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;

import static io.restassured.RestAssured.given;

/**
 * HTTP client for the /transfers endpoint.
 * Just wraps RestAssured calls so test methods don't have to deal with HTTP details directly.
 */
public class TransferClient {

    private final String baseUrl;

    // default constructor picks up the base URL from config (env var or system property)
    public TransferClient() {
        this(TestConfig.SERVICE_BASE_URL);
    }

    public TransferClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * POST /transfers
     * Pass null for idempotencyKey if you don't want the header sent (e.g. IDEM-10).
     */
    public Response createTransfer(TransferRequest request, String idempotencyKey) {
        RequestSpecification spec = baseSpec().body(request);
        // only attach the header if a key was actually provided
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
        // log only on failure so normal runs stay quiet
        return given()
                .contentType("application/json")
                .accept("application/json")
                .log().ifValidationFails();
    }
}

