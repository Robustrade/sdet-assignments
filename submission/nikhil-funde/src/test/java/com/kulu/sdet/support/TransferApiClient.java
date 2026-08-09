package com.kulu.sdet.support;

import static io.restassured.RestAssured.given;

import com.kulu.sdet.service.model.TransferRequest;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import java.util.LinkedHashMap;
import java.util.Map;

public class TransferApiClient {

  public Response createTransfer(TransferRequest request) {
    return createTransfer(request, null);
  }

  public Response createTransfer(TransferRequest request, String idempotencyKey) {
    var spec = given().contentType(ContentType.JSON).body(toMap(request));
    if (idempotencyKey != null) {
      spec = spec.header("Idempotency-Key", idempotencyKey);
    }
    return spec.when().post("/transfers");
  }

  public Response createTransfer(Map<String, Object> body) {
    return given().contentType(ContentType.JSON).body(body).when().post("/transfers");
  }

  public Response createTransfer(Map<String, Object> body, String idempotencyKey) {
    var spec = given().contentType(ContentType.JSON).body(body);
    if (idempotencyKey != null) {
      spec = spec.header("Idempotency-Key", idempotencyKey);
    }
    return spec.when().post("/transfers");
  }

  public Response getTransfer(String transferId) {
    return given().when().get("/transfers/{transferId}", transferId);
  }

  public Response getWallet(String walletId) {
    return given().when().get("/wallets/{walletId}", walletId);
  }

  private Map<String, Object> toMap(TransferRequest request) {
    Map<String, Object> map = new LinkedHashMap<>();
    if (request.sourceWalletId != null) {
      map.put("source_wallet_id", request.sourceWalletId);
    }
    if (request.destinationWalletId != null) {
      map.put("destination_wallet_id", request.destinationWalletId);
    }
    if (request.amount != null) {
      map.put("amount", request.amount);
    }
    if (request.currency != null) {
      map.put("currency", request.currency);
    }
    if (request.reference != null) {
      map.put("reference", request.reference);
    }
    return map;
  }
}
