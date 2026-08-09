package com.kulu.sdet;

import com.kulu.sdet.support.DatabaseVerifier;
import com.kulu.sdet.support.TestEnvironment;
import com.kulu.sdet.support.TransferApiClient;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(TestEnvironment.class)
class ValidationTest {

  @Test
  void missingSourceWallet(TransferApiClient client) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("destination_wallet_id", "wallet_002");
    body.put("amount", 100);
    body.put("currency", "AED");
    client.createTransfer(body).then().statusCode(422);
  }

  @Test
  void missingDestinationWallet(TransferApiClient client) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("amount", 100);
    body.put("currency", "AED");
    client.createTransfer(body).then().statusCode(422);
  }

  @Test
  void missingAmount(TransferApiClient client) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("destination_wallet_id", "wallet_002");
    body.put("currency", "AED");
    client.createTransfer(body).then().statusCode(422);
  }

  @Test
  void missingCurrency(TransferApiClient client) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("destination_wallet_id", "wallet_002");
    body.put("amount", 100);
    client.createTransfer(body).then().statusCode(422);
  }

  @Test
  void invalidCurrency(TransferApiClient client) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("destination_wallet_id", "wallet_002");
    body.put("amount", 100);
    body.put("currency", "XYZ");
    client.createTransfer(body).then().statusCode(422);
  }

  @Test
  void negativeAmount(TransferApiClient client) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("destination_wallet_id", "wallet_002");
    body.put("amount", -100);
    body.put("currency", "AED");
    client.createTransfer(body).then().statusCode(422);
  }

  @Test
  void zeroAmount(TransferApiClient client) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("destination_wallet_id", "wallet_002");
    body.put("amount", 0);
    body.put("currency", "AED");
    client.createTransfer(body).then().statusCode(422);
  }

  @Test
  void sameSourceAndDestination(TransferApiClient client) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("destination_wallet_id", "wallet_001");
    body.put("amount", 100);
    body.put("currency", "AED");
    client.createTransfer(body).then().statusCode(422);
  }

  @Test
  void invalidInputLeavesNoTransferRecord(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("destination_wallet_id", "wallet_002");
    body.put("amount", -999);
    body.put("currency", "AED");
    client.createTransfer(body);
    db.assertTransferCount(0);
  }

  @Test
  void invalidInputLeavesBalancesUnchanged(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("source_wallet_id", "wallet_001");
    body.put("destination_wallet_id", "wallet_002");
    body.put("amount", 0);
    body.put("currency", "AED");
    client.createTransfer(body);
    db.assertBalance("wallet_001", 10000);
    db.assertBalance("wallet_002", 5000);
  }
}
