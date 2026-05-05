package com.kulu.sdet.api;

import static io.restassured.RestAssured.given;

import io.restassured.RestAssured;
import io.restassured.response.Response;

public class TransferApiClient {
  static {
    RestAssured.baseURI = "http://localhost:8080";
  }

  public Response createTransfer(String src, String dest, int amount, String key) {
    String requestBody =
        "{"
            + "\"source_wallet_id\":\""
            + src
            + "\","
            + "\"destination_wallet_id\":\""
            + dest
            + "\","
            + "\"amount\":"
            + amount
            + ","
            + "\"currency\":\"AED\""
            + "}";

    return given()
        .header("Idempotency-Key", key)
        .contentType("application/json")
        .body(requestBody)
        .post("/transfers");
  }
}
