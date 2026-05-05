package com.kulu.sdet.stepdefs;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.api.TransferApiClient;
import com.kulu.sdet.util.TestContext;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import io.restassured.response.Response;

public class TransferSteps {

  private final TransferApiClient api = new TransferApiClient();
  private final TestContext context = new TestContext();

  @When("I create a transfer from {string} to {string} of {int} AED with idempotency key {string}")
  public void createTransfer(String source, String destination, int amount, String key) {
    Response response = api.createTransfer(source, destination, amount, key);
    context.setLastResponse(response);
  }

  @Then("the API response code should be {int}")
  public void apiResponseCodeShouldBe(int expected) {
    assertThat(context.getLastResponse().getStatusCode()).isEqualTo(expected);
  }

  @Then("the transfer status should be {string}")
  public void transferStatusShouldBe(String expectedStatus) {
    assertThat(context.getLastResponse().getStatusCode()).isEqualTo(200);
    assertThat(context.getLastResponse().jsonPath().getString("status")).isEqualTo(expectedStatus);
  }
}
