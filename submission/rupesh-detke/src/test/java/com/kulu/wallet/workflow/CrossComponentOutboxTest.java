package com.kulu.wallet.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.wallet.support.TestEnvironment;
import com.kulu.wallet.support.TransferRequestBuilder;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CrossComponentOutboxTest extends TestEnvironment {

  @Test
  void successfulTransferWritesExactlyOneOutboxEventAndAuditTrail() {
    seedWallet("wallet_001", "AED", 4_000);
    seedWallet("wallet_002", "AED", 100);

    var response =
        api.createTransfer(
            UUID.randomUUID().toString(), TransferRequestBuilder.aTransfer().amount(400).build());

    assertThat(response.statusCode()).isEqualTo(201);
    String transferId = response.jsonPath().getString("transfer_id");

    db.assertSuccessfulTransferPersisted(transferId, "wallet_001", "wallet_002", 400, "AED");
    db.assertOutboxCount(1);
  }

  @Test
  void idempotentReplayDoesNotEmitSecondOutboxEvent() {
    seedWallet("wallet_001", "AED", 4_000);
    seedWallet("wallet_002", "AED", 100);

    String key = UUID.randomUUID().toString();
    var body = TransferRequestBuilder.aTransfer().amount(400).build();

    assertThat(api.createTransfer(key, body).statusCode()).isEqualTo(201);
    assertThat(api.createTransfer(key, body).statusCode()).isEqualTo(201);

    db.assertOutboxCount(1);
    db.assertTransferCount(1);
  }
}
