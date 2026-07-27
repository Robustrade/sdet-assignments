package com.kulu.sdet.workflow;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.Test;

/**
 * Coherence of the transfer view between POST and GET, and coherence of the wallet view after a
 * transfer completes. Consumers rely on these two shapes being interchangeable.
 */
class TransferLifecycleTest extends ApiTestBase {

  @Test
  void postAndGetReturnTheSameTransferView() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);

    var created =
        api.postTransfer(
            IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 1_234, "AED", "invoice_42"));
    String id = created.jsonPath().getString("id");

    var fetched = api.getTransfer(id);

    assertThat(fetched.statusCode()).isEqualTo(200);
    for (String field :
        new String[] {
          "id",
          "source_wallet_id",
          "destination_wallet_id",
          "amount",
          "currency",
          "reference",
          "status",
          "idempotency_key"
        }) {
      assertThat(fetched.jsonPath().getString(field))
          .as("field %s should match between POST and GET", field)
          .isEqualTo(created.jsonPath().getString(field));
    }
  }

  @Test
  void walletBalanceViewMatchesDbAfterTransfer() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);

    api.postTransfer(
        IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 3_000, "AED", "invoice_43"));

    var walletA = api.getWallet("wallet_a");
    var walletB = api.getWallet("wallet_b");

    assertThat(walletA.jsonPath().getLong("balance")).isEqualTo(db.balanceOf("wallet_a"));
    assertThat(walletB.jsonPath().getLong("balance")).isEqualTo(db.balanceOf("wallet_b"));
    assertThat(walletA.jsonPath().getLong("balance")).isEqualTo(7_000L);
    assertThat(walletB.jsonPath().getLong("balance")).isEqualTo(3_000L);
  }
}
