package com.kulu.sdet;

import com.kulu.sdet.support.DatabaseVerifier;
import com.kulu.sdet.support.TestEnvironment;
import com.kulu.sdet.support.TransferApiClient;
import com.kulu.sdet.support.TransferRequestBuilder;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(TestEnvironment.class)
class InsufficientBalanceTest {

  @Test
  void insufficientBalanceReturns422(TransferApiClient client) {
    client
        .createTransfer(TransferRequestBuilder.aTransfer().amount(99999).build())
        .then()
        .statusCode(422);
  }

  @Test
  void insufficientBalanceSourceUnchanged(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(99999).build());
    db.assertBalance("wallet_001", 10000);
  }

  @Test
  void insufficientBalanceDestinationUnchanged(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(99999).build());
    db.assertBalance("wallet_002", 5000);
  }

  @Test
  void insufficientBalanceNoTransferRecord(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(99999).build());
    db.assertTransferCount(0);
  }

  @Test
  void insufficientBalanceNoAuditEvent(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(99999).build());
    db.assertAuditEventCount(0);
  }

  @Test
  void insufficientBalanceNoOutboxEvent(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(99999).build());
    db.assertOutboxEventCount(0);
  }

  @Test
  void zeroBalanceWalletRejected(TransferApiClient client) {
    client
        .createTransfer(
            TransferRequestBuilder.aTransfer()
                .from("wallet_003")
                .to("wallet_001")
                .amount(1)
                .build())
        .then()
        .statusCode(422);
  }

  @Test
  void exactBalanceTransferSucceeds(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    client
        .createTransfer(TransferRequestBuilder.aTransfer().amount(10000).build())
        .then()
        .statusCode(201);
    db.assertBalance("wallet_001", 0);
  }
}
