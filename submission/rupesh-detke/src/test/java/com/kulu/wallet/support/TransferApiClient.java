package com.kulu.wallet.support;

import static io.restassured.RestAssured.given;

import io.restassured.http.ContentType;
import io.restassured.response.Response;
import java.util.Map;

public class TransferApiClient {
  private final String baseUrl;

  public TransferApiClient(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public Response createTransfer(String idempotencyKey, Map<String, Object> body) {
    var request = given().baseUri(baseUrl).contentType(ContentType.JSON).body(body);
    if (idempotencyKey != null) {
      request = request.header("Idempotency-Key", idempotencyKey);
    }
    return request.when().post("/transfers");
  }

  public Response getTransfer(String transferId) {
    return given().baseUri(baseUrl).when().get("/transfers/{id}", transferId);
  }

  public Response getWallet(String walletId) {
    return given().baseUri(baseUrl).when().get("/wallets/{id}", walletId);
  }
}
