package com.wallet.client;

import com.wallet.model.TransferRequest;
import com.wallet.model.TransferResponse;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.UUID;

import static io.restassured.RestAssured.given;

/**
 * Typed HTTP client wrapping RestAssured for the Wallet Transfer Service API.
 *
 * Design principles:
 * - Every method returns the raw Response so callers control assertion style
 * - Overloads provide ergonomic defaults (idempotency key auto-generated)
 * - No assertions here — callers decide what to verify
 */
public class WalletTransferApiClient {

    private static final Logger log = LoggerFactory.getLogger(WalletTransferApiClient.class);

    private static final String TRANSFERS_PATH    = "/api/v1/transfers";
    private static final String TRANSFER_PATH     = "/api/v1/transfers/{transferId}";
    private static final String WALLET_PATH       = "/api/v1/wallets/{walletId}";
    private static final String HEALTH_PATH       = "/health";
    private static final String CONTENT_TYPE_JSON = "application/json";

    private static final String HEADER_IDEMPOTENCY_KEY = "Idempotency-Key";
    private static final String HEADER_CONTENT_TYPE    = "Content-Type";
    private static final String HEADER_ACCEPT          = "Accept";
    private static final String HEADER_CORRELATION_ID  = "X-Correlation-ID";

    private final String baseUrl;

    public WalletTransferApiClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    // ─── Transfer Operations ─────────────────────────────────────────────────

    /**
     * POST /api/v1/transfers — initiates a wallet transfer.
     * Auto-generates a random idempotency key.
     */
    public Response initiateTransfer(TransferRequest request) {
        return initiateTransfer(request, UUID.randomUUID().toString());
    }

    /**
     * POST /api/v1/transfers — with explicit idempotency key.
     */
    public Response initiateTransfer(TransferRequest request, String idempotencyKey) {
        log.debug("POST {} idempotencyKey={}", TRANSFERS_PATH, idempotencyKey);
        return baseRequest()
                .header(HEADER_IDEMPOTENCY_KEY, idempotencyKey)
                .body(request)
                .post(TRANSFERS_PATH);
    }

    /**
     * POST /api/v1/transfers — with additional custom headers (for header mutation tests).
     */
    public Response initiateTransfer(TransferRequest request, String idempotencyKey,
                                     Map<String, String> extraHeaders) {
        RequestSpecification spec = baseRequest()
                .header(HEADER_IDEMPOTENCY_KEY, idempotencyKey);

        for (Map.Entry<String, String> header : extraHeaders.entrySet()) {
            spec = spec.header(header.getKey(), header.getValue());
        }

        return spec.body(request).post(TRANSFERS_PATH);
    }

    /**
     * POST /api/v1/transfers — without idempotency key header (negative test).
     */
    public Response initiateTransferWithoutIdempotencyKey(TransferRequest request) {
        log.debug("POST {} (no idempotency key)", TRANSFERS_PATH);
        return baseRequest()
                .body(request)
                .post(TRANSFERS_PATH);
    }

    /**
     * POST /api/v1/transfers — with raw body string (malformed payload tests).
     */
    public Response initiateTransferRaw(String rawBody, String idempotencyKey) {
        log.debug("POST {} raw body", TRANSFERS_PATH);
        return given()
                .baseUri(baseUrl)
                .header(HEADER_CONTENT_TYPE, CONTENT_TYPE_JSON)
                .header(HEADER_ACCEPT, CONTENT_TYPE_JSON)
                .header(HEADER_IDEMPOTENCY_KEY, idempotencyKey)
                .body(rawBody)
                .post(TRANSFERS_PATH);
    }

    /**
     * GET /api/v1/transfers/{transferId} — retrieves a transfer by ID.
     */
    public Response getTransfer(String transferId) {
        log.debug("GET {}/{}", TRANSFERS_PATH, transferId);
        return baseRequest()
                .pathParam("transferId", transferId)
                .get(TRANSFER_PATH);
    }

    /**
     * GET /api/v1/wallets/{walletId} — retrieves wallet by ID.
     */
    public Response getWallet(String walletId) {
        log.debug("GET /api/v1/wallets/{}", walletId);
        return baseRequest()
                .pathParam("walletId", walletId)
                .get(WALLET_PATH);
    }

    /**
     * GET /health — service health check.
     */
    public Response health() {
        return given()
                .baseUri(baseUrl)
                .get(HEALTH_PATH);
    }

    // ─── Response parsing helpers ─────────────────────────────────────────────

    public TransferResponse parseResponse(Response response) {
        return response.as(TransferResponse.class);
    }

    public String extractTransferId(Response response) {
        return response.jsonPath().getString("transfer_id");
    }

    public String extractStatus(Response response) {
        return response.jsonPath().getString("status");
    }

    public String extractErrorCode(Response response) {
        return response.jsonPath().getString("error_code");
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    private RequestSpecification baseRequest() {
        return given()
                .baseUri(baseUrl)
                .header(HEADER_CONTENT_TYPE, CONTENT_TYPE_JSON)
                .header(HEADER_ACCEPT, CONTENT_TYPE_JSON)
                .header(HEADER_CORRELATION_ID, UUID.randomUUID().toString());
    }
}