package com.kulu.wallet.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.wallet.support.TestEnvironment;
import com.kulu.wallet.support.TransferRequestBuilder;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class HappyPathTransferTest extends TestEnvironment {

  @Test
  void successfulTransferDebitsAndCreditsExactlyOnce() {
    seedWallet("wallet_001", "AED", 10_000);
    seedWallet("wallet_002", "AED", 1_000);

    String key = UUID.randomUUID().toString();
    Map<String, Object> body =
        TransferRequestBuilder.aTransfer()
            .from("wallet_001")
            .to("wallet_002")
            .amount(2500)
            .currency("AED")
            .reference("invoice_123")
            .build();

    var response = api.createTransfer(key, body);

    assertThat(response.statusCode()).isEqualTo(201);
    assertThat(response.jsonPath().getString("status")).isEqualTo("COMPLETED");
    assertThat(response.jsonPath().getLong("amount")).isEqualTo(2500);
    String transferId = response.jsonPath().getString("transfer_id");
    assertThat(transferId).isNotBlank();

    db.assertBalances("wallet_001", 7_500, "wallet_002", 3_500);
    db.assertSuccessfulTransferPersisted(transferId, "wallet_001", "wallet_002", 2500, "AED");
    db.assertTransferCount(1);
    db.assertOutboxCount(1);

    var walletApi = api.getWallet("wallet_001");
    assertThat(walletApi.statusCode()).isEqualTo(200);
    assertThat(walletApi.jsonPath().getLong("balance")).isEqualTo(7_500);

    var transferApi = api.getTransfer(transferId);
    assertThat(transferApi.statusCode()).isEqualTo(200);
    assertThat(transferApi.jsonPath().getString("status")).isEqualTo("COMPLETED");
  }
}
