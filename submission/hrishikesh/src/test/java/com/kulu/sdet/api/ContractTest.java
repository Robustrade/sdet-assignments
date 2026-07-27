package com.kulu.sdet.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.WalletApiClient;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.Test;

/**
 * Contract-level assertions on the API surface: status codes, response payload shape, headers.
 * These are the tests a consumer team would need to know they can rely on.
 */
class ContractTest extends ApiTestBase {

  @Test
  void happyPathReturns201WithFullTransferPayload() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);

    var response =
        api.postTransfer(
            IdemKey.fresh(),
            WalletApiClient.transferBody("wallet_a", "wallet_b", 2_500, "AED", "invoice_1"));

    assertThat(response.statusCode()).isEqualTo(201);
    assertThat(response.contentType()).contains("application/json");
    assertThat(response.jsonPath().getString("id")).isNotBlank();
    assertThat(response.jsonPath().getString("source_wallet_id")).isEqualTo("wallet_a");
    assertThat(response.jsonPath().getString("destination_wallet_id")).isEqualTo("wallet_b");
    assertThat(response.jsonPath().getLong("amount")).isEqualTo(2_500L);
    assertThat(response.jsonPath().getString("currency")).isEqualTo("AED");
    assertThat(response.jsonPath().getString("reference")).isEqualTo("invoice_1");
    assertThat(response.jsonPath().getString("status")).isEqualTo("completed");
    assertThat(response.jsonPath().getString("created_at")).isNotBlank();
  }

  @Test
  void getWalletExposesCurrentBalance() {
    seedWallet("wallet_a", 4_242);

    var response = api.getWallet("wallet_a");

    assertThat(response.statusCode()).isEqualTo(200);
    assertThat(response.jsonPath().getLong("balance")).isEqualTo(4_242L);
    assertThat(response.jsonPath().getString("currency")).isEqualTo("AED");
  }

  @Test
  void getTransferReturns404WhenUnknown() {
    var response = api.getTransfer("does-not-exist");

    assertThat(response.statusCode()).isEqualTo(404);
    assertThat(response.jsonPath().getString("code")).isEqualTo("transfer_not_found");
  }

  @Test
  void getWalletReturns404WhenUnknown() {
    var response = api.getWallet("does-not-exist");

    assertThat(response.statusCode()).isEqualTo(404);
    assertThat(response.jsonPath().getString("code")).isEqualTo("wallet_not_found");
  }
}
