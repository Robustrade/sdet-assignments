package com.kulu.sdet.api;

import static io.restassured.RestAssured.given;

import io.restassured.response.Response;
import java.util.HashMap;
import java.util.Map;

public class TransferApiClient {
  public Response createTransfer(
      String sourceWallet, String destinationWallet, int amount, String idempotencyKey) {

    Map<String, Object> payload = new HashMap<>();
    payload.put("sourceWallet", sourceWallet);
    payload.put("destinationWallet", destinationWallet);
    payload.put("amount", amount);

    return given()
        .contentType("application/json")
        .header("Idempotency-Key", idempotencyKey)
        .body(payload) // ✅ RestAssured handles JSON correctly
        .post("/transfers");
  }
}
