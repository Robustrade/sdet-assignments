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
class IdempotencyTest {

  @Test
  void sameKeySamePayloadReturnsOriginal(TransferApiClient client) {
    var request = TransferRequestBuilder.aTransfer().amount(1000).build();
    Response resp1 = client.createTransfer(request, "idem-001");
    Response resp2 = client.createTransfer(request, "idem-001");

    resp1.then().statusCode(201);
    resp2.then().statusCode(200);
    org.assertj.core.api.Assertions.assertThat(resp1.jsonPath().getString("id"))
        .isEqualTo(resp2.jsonPath().getString("id"));
  }

  @Test
  void sameKeySamePayloadNoDoubleDebit(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    var request = TransferRequestBuilder.aTransfer().amount(1000).build();
    client.createTransfer(request, "idem-002");
    client.createTransfer(request, "idem-002");
    db.assertBalance("wallet_001", 9000);
  }

  @Test
  void sameKeySamePayloadSingleTransferRow(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    var request = TransferRequestBuilder.aTransfer().amount(1000).build();
    client.createTransfer(request, "idem-003");
    client.createTransfer(request, "idem-003");
    db.assertTransferCount(1);
  }

  @Test
  void sameKeySamePayloadSingleAuditEvent(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    var request = TransferRequestBuilder.aTransfer().amount(1000).build();
    client.createTransfer(request, "idem-audit");
    client.createTransfer(request, "idem-audit");
    db.assertAuditEventCount(1);
  }

  @Test
  void sameKeyDifferentPayloadRejected(TransferApiClient client) {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(1000).build(), "idem-004");

    client
        .createTransfer(TransferRequestBuilder.aTransfer().amount(2000).build(), "idem-004")
        .then()
        .statusCode(409)
        .body("error", equalTo("idempotency key conflict"));
  }

  @Test
  void sameKeyDifferentPayloadNoSecondTransfer(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(1000).build(), "idem-005");
    client.createTransfer(TransferRequestBuilder.aTransfer().amount(2000).build(), "idem-005");
    db.assertTransferCount(1);
    db.assertBalance("wallet_001", 9000);
  }

  @Test
  void noIdempotencyKeyCreatesIndependentTransfers(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    var request = TransferRequestBuilder.aTransfer().amount(100).build();
    Response resp1 = client.createTransfer(request);
    Response resp2 = client.createTransfer(request);

    resp1.then().statusCode(201);
    resp2.then().statusCode(201);
    org.assertj.core.api.Assertions.assertThat(resp1.jsonPath().getString("id"))
        .isNotEqualTo(resp2.jsonPath().getString("id"));
    db.assertTransferCount(2);
  }
}
