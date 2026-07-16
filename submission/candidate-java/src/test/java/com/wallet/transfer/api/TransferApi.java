package com.wallet.transfer.api;

import com.wallet.transfer.dto.TransferRequest;
import com.wallet.transfer.dto.TransferResponse;
import com.wallet.transfer.dto.WalletResponse;
import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.math.BigDecimal;
import java.util.UUID;

public class TransferApi {
  private final String baseUrl;
  private final int port;

  public TransferApi(String baseUrl, int port) {
    this.baseUrl = baseUrl;
    this.port = port;
  }

  private RequestSpecification baseSpec() {
    return RestAssured.given()
        .baseUri(baseUrl)
        .port(port)
        .contentType(ContentType.JSON)
        .accept(ContentType.JSON);
  }

  public RequestSpecification getSpec() {
    return baseSpec();
  }

  public TransferResponse createTransfer(TransferRequest request, String idempotencyKey) {
    Response response =
        baseSpec()
            .header("Idempotency-Key", idempotencyKey)
            .body(request)
            .when()
            .post("/transfers")
            .then()
            .statusCode(201)
            .extract()
            .response();

    return response.as(TransferResponse.class);
  }

  public Response createTransferRaw(TransferRequest request, String idempotencyKey) {
    return baseSpec()
        .header("Idempotency-Key", idempotencyKey)
        .body(request)
        .when()
        .post("/transfers")
        .then()
        .extract()
        .response();
  }

  public TransferResponse createTransferWithStatus(
      TransferRequest request, String idempotencyKey, int expectedStatus) {
    Response response =
        baseSpec()
            .header("Idempotency-Key", idempotencyKey)
            .body(request)
            .when()
            .post("/transfers")
            .then()
            .statusCode(expectedStatus)
            .extract()
            .response();

    if (expectedStatus >= 200 && expectedStatus < 300) {
      return response.as(TransferResponse.class);
    }
    return null;
  }

  public TransferResponse getTransfer(UUID transferId) {
    return baseSpec()
        .when()
        .get("/transfers/{id}", transferId)
        .then()
        .statusCode(200)
        .extract()
        .as(TransferResponse.class);
  }

  public Response getTransferRaw(UUID transferId) {
    return baseSpec().when().get("/transfers/{id}", transferId).then().extract().response();
  }

  public WalletResponse getWallet(String walletId) {
    return baseSpec()
        .when()
        .get("/wallets/{id}", walletId)
        .then()
        .statusCode(200)
        .extract()
        .as(WalletResponse.class);
  }

  public Response getWalletRaw(String walletId) {
    return baseSpec().when().get("/wallets/{id}", walletId).then().extract().response();
  }

  public static TransferRequest validTransferRequest(
      String sourceWalletId, String destinationWalletId, BigDecimal amount) {
    return new TransferRequest(
        sourceWalletId,
        destinationWalletId,
        amount,
        "INR",
        "reference_" + System.currentTimeMillis());
  }

  public static String generateIdempotencyKey() {
    return UUID.randomUUID().toString();
  }
}
