package com.kulu.sdet.util;

import io.restassured.response.Response;

public class TestContext {

  private Response lastResponse;

  public Response getLastResponse() {
    return lastResponse;
  }

  public void setLastResponse(Response lastResponse) {
    this.lastResponse = lastResponse;
  }
}
