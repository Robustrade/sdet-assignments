package com.robustrade.wallet.support;

import com.robustrade.wallet.dto.TransferRequestDto;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;

import static io.restassured.RestAssured.given;

/** Thin wrapper around RestAssured -- test classes never build raw HTTP calls themselves. */
public class TransferApiClient {

    public Response createTransfer(TransferRequestDto request, String idempotencyKey) {
        RequestSpecification spec = given().contentType("application/json").body(request);
        if (idempotencyKey != null) {
            spec = spec.header("Idempotency-Key", idempotencyKey);
        }
        return spec.when().post("/transfers");
    }

    /** For malformed-body tests where we need to send raw, possibly-invalid JSON. */
    public Response createTransferRaw(String rawJsonBody, String idempotencyKey) {
        RequestSpecification spec = given().contentType("application/json").body(rawJsonBody);
        if (idempotencyKey != null) {
            spec = spec.header("Idempotency-Key", idempotencyKey);
        }
        return spec.when().post("/transfers");
    }

    public Response getTransfer(String transferId) {
        return given().when().get("/transfers/" + transferId);
    }

    public Response getWallet(String walletId) {
        return given().when().get("/wallets/" + walletId);
    }
}
