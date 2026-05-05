package com.kulu.sdet.stepdefs;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.api.WalletApiClient;
import io.cucumber.java.en.Then;

public class WalletBalanceSteps {

  private final WalletApiClient walletApi = new WalletApiClient();

  @Then("wallet {string} balance should be {int} AED via API")
  public void walletBalanceViaApi(String walletId, int expected) {

    var response = walletApi.getWallet(walletId);

    assertThat(response.getStatusCode()).isEqualTo(200);
    assertThat(response.jsonPath().getInt("balance")).isEqualTo(expected);
  }

  @Then("wallet {string} balance should remain {int} AED")
  public void walletBalanceShouldRemain(String walletId, int expected) {
    walletBalanceViaApi(walletId, expected);
  }

  @Then("wallet {string} balance should not be negative")
  public void walletBalanceNotNegative(String walletId) {

    var response = walletApi.getWallet(walletId);

    assertThat(response.getStatusCode()).isEqualTo(200);
    assertThat(response.jsonPath().getInt("balance")).isGreaterThanOrEqualTo(0);
  }
}
