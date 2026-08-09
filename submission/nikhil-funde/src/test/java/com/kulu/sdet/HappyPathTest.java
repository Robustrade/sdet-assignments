package com.kulu.sdet;

import static org.hamcrest.Matchers.equalTo;

import com.kulu.sdet.support.DatabaseVerifier;
import com.kulu.sdet.support.TestEnvironment;
import com.kulu.sdet.support.TransferApiClient;
import com.kulu.sdet.support.TransferRequestBuilder;
import io.restassured.response.Response;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(TestEnvironment.class)
class HappyPathTest {

  @Test
  void transferReturns201(TransferApiClient client) {
    client
        .createTransfer(
            TransferRequestBuilder.aTransfer().amount(2500).reference("invoice_123").build(),
            "hp-001")
        .then()
        .statusCode(201)
        .body("status", equalTo("completed"))
        .body("amount", equalTo(2500));
  }

  @Test
  void sourceBalanceDecremented(TransferApiClient client, DatabaseVerifier db) throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(1000).build());
    db.assertBalance("wallet_001", 9000);
  }

  @Test
  void destinationBalanceIncremented(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(1000).build());
    db.assertBalance("wallet_002", 6000);
  }

  @Test
  void netBalanceMovementEqualsAmount(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    long beforeSrc = db.getBalance("wallet_001");
    long beforeDst = db.getBalance("wallet_002");

    client.createTransfer(TransferRequestBuilder.aTransfer().amount(3000).build());

    long afterSrc = db.getBalance("wallet_001");
    long afterDst = db.getBalance("wallet_002");
    org.assertj.core.api.Assertions.assertThat(beforeSrc - afterSrc).isEqualTo(3000);
    org.assertj.core.api.Assertions.assertThat(afterDst - beforeDst).isEqualTo(3000);
  }

  @Test
  void transferRecordPersisted(TransferApiClient client, DatabaseVerifier db) throws Exception {
    Response resp = client.createTransfer(TransferRequestBuilder.aTransfer().amount(500).build());
    String transferId = resp.jsonPath().getString("id");
    db.assertTransferRow(transferId, "completed", 500);
  }

  @Test
  void auditEventCreated(TransferApiClient client, DatabaseVerifier db) throws Exception {
    Response resp = client.createTransfer(TransferRequestBuilder.aTransfer().amount(500).build());
    String transferId = resp.jsonPath().getString("id");
    db.assertAuditEventCount(1);
    db.assertAuditEventForTransfer(transferId, "transfer_completed");
  }

  @Test
  void outboxEventCreated(TransferApiClient client, DatabaseVerifier db) throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(500).build());
    db.assertOutboxEventCount(1);
  }

  @Test
  void getTransferReturnsCorrectState(TransferApiClient client) {
    Response postResp =
        client.createTransfer(TransferRequestBuilder.aTransfer().amount(300).build());
    String transferId = postResp.jsonPath().getString("id");

    client.getTransfer(transferId).then().statusCode(200).body("status", equalTo("completed"));
  }

  @Test
  void getWalletReflectsUpdatedBalance(TransferApiClient client) {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(2000).build());
    client.getWallet("wallet_001").then().statusCode(200).body("balance", equalTo(8000));
  }

  @Test
  void apiAndDbTransferStateConsistent(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    Response resp = client.createTransfer(TransferRequestBuilder.aTransfer().amount(750).build());
    String transferId = resp.jsonPath().getString("id");
    String apiStatus = resp.jsonPath().getString("status");
    int apiAmount = resp.jsonPath().getInt("amount");

    db.assertTransferRow(transferId, apiStatus, apiAmount);
  }
}
