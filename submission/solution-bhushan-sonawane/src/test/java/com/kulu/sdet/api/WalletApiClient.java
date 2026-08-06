package com.kulu.sdet.api;

import static io.restassured.RestAssured.given;

import io.restassured.RestAssured;
import io.restassured.response.Response;

public class WalletApiClient {

  static {
    RestAssured.baseURI = "http://localhost:8080";
  }

  public Response getWallet(String walletId) {
    return given().contentType("application/json").get("/wallets/" + walletId);
  }
}
