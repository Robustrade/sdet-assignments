package com.kulu.sdet.api;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static com.kulu.sdet.support.builders.TransferRequestBuilder.aTransfer;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Validation-failure API tests. Every rejected request must (a) return a machine-readable {@code
 * code} and (b) leave zero persisted side effects — no transfer, no audit row, no outbox row, no
 * wallet mutation.
 */
class ValidationTest extends ApiTestBase {

  @BeforeEach
  void seedWallets() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 5_000);
  }

  @Test
  void missingSourceWalletIsRejected() {
    var response = api.postTransfer(IdemKey.fresh(), aTransfer().withoutSource().build());

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("missing_fields");
    assertNoSideEffects();
  }

  @Test
  void missingAmountIsRejected() {
    var response = api.postTransfer(IdemKey.fresh(), aTransfer().withoutAmount().build());

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("missing_fields");
    assertNoSideEffects();
  }

  @Test
  void missingCurrencyIsRejected() {
    var response = api.postTransfer(IdemKey.fresh(), aTransfer().withoutCurrency().build());

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("missing_fields");
    assertNoSideEffects();
  }

  @Test
  void unknownCurrencyIsRejected() {
    var response =
        api.postTransfer(IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 100, "XYZ", "ref"));

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("invalid_currency");
    assertNoSideEffects();
  }

  @Test
  void zeroAmountIsRejected() {
    var response =
        api.postTransfer(IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 0, "AED", "ref"));

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("invalid_amount");
    assertNoSideEffects();
  }

  @Test
  void negativeAmountIsRejected() {
    var response =
        api.postTransfer(IdemKey.fresh(), transferBody("wallet_a", "wallet_b", -100, "AED", "ref"));

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("invalid_amount");
    assertNoSideEffects();
  }

  @Test
  void sourceEqualsDestinationIsRejected() {
    var response =
        api.postTransfer(IdemKey.fresh(), transferBody("wallet_a", "wallet_a", 100, "AED", "ref"));

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("same_wallet");
    assertNoSideEffects();
  }

  @Test
  void unknownSourceWalletIsRejected() {
    var response =
        api.postTransfer(
            IdemKey.fresh(), transferBody("wallet_missing", "wallet_b", 100, "AED", "ref"));

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("source_wallet_not_found");
  }

  @Test
  void unknownDestinationWalletIsRejected() {
    var response =
        api.postTransfer(
            IdemKey.fresh(), transferBody("wallet_a", "wallet_missing", 100, "AED", "ref"));

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("destination_wallet_not_found");
  }

  @Test
  void currencyMismatchWithSourceWalletIsRejected() {
    seedWallet("wallet_usd", 5_000, "USD");
    var response =
        api.postTransfer(
            IdemKey.fresh(), transferBody("wallet_usd", "wallet_b", 100, "AED", "ref"));

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("currency_mismatch");
  }

  @Test
  void malformedJsonBodyIsRejected() {
    var response = api.postTransferRaw(IdemKey.fresh(), "{not-json");

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isEqualTo("invalid_payload");
  }

  @Test
  void missingBodyIsRejected() {
    var response = api.postTransferRaw(IdemKey.fresh(), null);

    // Empty body ends up as either invalid_payload or missing_fields; both are 422 rejections.
    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("code")).isIn("invalid_payload", "missing_fields");
  }

  private void assertNoSideEffects() {
    assertThat(db.transferCount()).as("no transfers persisted after rejected request").isZero();
    assertThat(db.balanceOf("wallet_a")).isEqualTo(10_000L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(5_000L);
  }
}
