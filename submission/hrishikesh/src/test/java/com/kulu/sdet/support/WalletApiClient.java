package com.kulu.sdet.support;

import static io.restassured.RestAssured.given;

import io.restassured.response.Response;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Thin API client used from every test. Keeps HTTP transport details out of scenario code so tests
 * read like business behaviors rather than {@code given/when/then} boilerplate.
 */
@Component
public class WalletApiClient {

  private int port;

  public void setPort(int port) {
    this.port = port;
  }

  public Response postTransfer(String idempotencyKey, Map<String, Object> body) {
    var req = given().port(port).contentType("application/json");
    if (idempotencyKey != null) {
      req = req.header("Idempotency-Key", idempotencyKey);
    }
    if (body != null) {
      req = req.body(body);
    }
    return req.post("/transfers").then().extract().response();
  }

  public Response postTransferRaw(String idempotencyKey, String rawBody) {
    var req = given().port(port).contentType("application/json");
    if (idempotencyKey != null) {
      req = req.header("Idempotency-Key", idempotencyKey);
    }
    if (rawBody != null) {
      req = req.body(rawBody);
    }
    return req.post("/transfers").then().extract().response();
  }

  public Response getTransfer(String transferId) {
    return given().port(port).get("/transfers/{id}", transferId).then().extract().response();
  }

  public Response getWallet(String walletId) {
    return given().port(port).get("/wallets/{id}", walletId).then().extract().response();
  }

  /** Convenience builder for a well-formed transfer payload. */
  public static Map<String, Object> transferBody(
      String source, String destination, long amount, String currency, String reference) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", source);
    body.put("destination_wallet_id", destination);
    body.put("amount", amount);
    body.put("currency", currency);
    if (reference != null) {
      body.put("reference", reference);
    }
    return body;
  }
}
