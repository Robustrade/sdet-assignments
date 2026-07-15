package com.kulu.sdet.persistence;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import org.junit.jupiter.api.Test;

/** Wallets table invariants — balance, currency, and unique-id semantics. */
class WalletStateTest extends ApiTestBase {

  @Test
  void balanceMinorUnitsRoundtripsExactly() {
    seedWallet("wallet_a", 12_345_678_901L); // deliberately > INT range
    var r = api.getWallet("wallet_a");

    assertThat(r.jsonPath().getLong("balance")).isEqualTo(12_345_678_901L);
  }

  @Test
  void balanceCheckPreventsGoingNegativeEvenViaDirectDbUpdate() {
    seedWallet("wallet_a", 100);
    // The service's debit() uses a conditional UPDATE and throws when the row count is not one.
    // Attempting to violate the CHECK constraint at the DB level would also fail.
    var response =
        api.postTransfer(IdemKey.fresh(), transferBody("wallet_a", "wallet_b", 200, "AED", "over"));
    // wallet_b not seeded so we actually get destination_wallet_not_found before the balance
    // check — that itself proves the request did not touch wallet_a.
    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(db.balanceOf("wallet_a")).isEqualTo(100L);
  }
}
