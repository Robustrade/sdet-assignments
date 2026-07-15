package com.kulu.sdet.idempotency;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.Test;

/**
 * An idempotency key is a promise: "if you see me again, only accept me with the exact same
 * payload." A mismatch is an integrity signal, not a retry — the server must refuse with 409 and
 * must not overwrite or duplicate the original transfer.
 */
class SameKeyDifferentPayloadTest extends ApiTestBase {

  @Test
  void differentAmountReplayReturns409AndDoesNotAlterState() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();

    var first =
        api.postTransfer(key, transferBody("wallet_a", "wallet_b", 2_500, "AED", "invoice_1"));
    assertThat(first.statusCode()).isEqualTo(201);
    String originalTransferId = first.jsonPath().getString("id");

    var conflict =
        api.postTransfer(key, transferBody("wallet_a", "wallet_b", 9_999, "AED", "invoice_1"));

    assertThat(conflict.statusCode()).isEqualTo(409);
    assertThat(conflict.jsonPath().getString("code")).isEqualTo("idempotency_key_conflict");

    assertThat(db.transferCountForIdempotencyKey(key)).isEqualTo(1);
    assertThat(db.transferRow(originalTransferId).get("amount")).isEqualTo(2_500L);
    assertThat(db.balanceOf("wallet_a")).isEqualTo(7_500L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(2_500L);
  }

  @Test
  void differentDestinationReplayReturns409() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    seedWallet("wallet_c", 0);
    String key = IdemKey.fresh();

    api.postTransfer(key, transferBody("wallet_a", "wallet_b", 1_000, "AED", "ref"));
    var conflict = api.postTransfer(key, transferBody("wallet_a", "wallet_c", 1_000, "AED", "ref"));

    assertThat(conflict.statusCode()).isEqualTo(409);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(1_000L);
    assertThat(db.balanceOf("wallet_c")).isEqualTo(0L);
  }

  @Test
  void differentReferenceReplayReturns409() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();

    api.postTransfer(key, transferBody("wallet_a", "wallet_b", 1_000, "AED", "ref_1"));
    var conflict =
        api.postTransfer(key, transferBody("wallet_a", "wallet_b", 1_000, "AED", "ref_2"));

    assertThat(conflict.statusCode()).isEqualTo(409);
    assertThat(db.transferCountForIdempotencyKey(key)).isEqualTo(1);
  }
}
