package com.kulu.sdet;

import com.kulu.sdet.service.WalletTransferApp;
import com.kulu.sdet.support.DatabaseVerifier;
import com.kulu.sdet.support.TestEnvironment;
import com.kulu.sdet.support.TransferApiClient;
import com.kulu.sdet.support.TransferRequestBuilder;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.assertj.core.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(TestEnvironment.class)
class TransferReliabilityTest {

  @Test
  void concurrentTransfersBalanceNeverGoesNegative(WalletTransferApp app, DatabaseVerifier db)
      throws Exception {
    List<Integer> statuses = new ArrayList<>();
    ExecutorService executor = Executors.newFixedThreadPool(5);
    CountDownLatch latch = new CountDownLatch(5);

    for (int i = 0; i < 5; i++) {
      executor.submit(
          () -> {
            try {
              int status =
                  io.restassured.RestAssured.given()
                      .contentType("application/json")
                      .body(
                          """
                          {
                            "source_wallet_id": "wallet_001",
                            "destination_wallet_id": "wallet_002",
                            "amount": 3000,
                            "currency": "AED"
                          }
                          """)
                      .post("/transfers")
                      .statusCode();
              synchronized (statuses) {
                statuses.add(status);
              }
            } finally {
              latch.countDown();
            }
          });
    }

    latch.await(30, TimeUnit.SECONDS);
    executor.shutdown();

    int successes = (int) statuses.stream().filter(s -> s == 201).count();
    Assertions.assertThat(successes).isLessThanOrEqualTo(3);
    Assertions.assertThat(db.getBalance("wallet_001")).isGreaterThanOrEqualTo(0);
    Assertions.assertThat(db.getBalance("wallet_001")).isEqualTo(10000 - successes * 3000L);
  }

  @Test
  void concurrentSameIdempotencyKeyProducesOneTransfer(WalletTransferApp app, DatabaseVerifier db)
      throws Exception {
    List<Integer> statuses = new ArrayList<>();
    ExecutorService executor = Executors.newFixedThreadPool(10);
    CountDownLatch latch = new CountDownLatch(10);

    for (int i = 0; i < 10; i++) {
      executor.submit(
          () -> {
            try {
              int status =
                  io.restassured.RestAssured.given()
                      .contentType("application/json")
                      .header("Idempotency-Key", "concurrent-idem-001")
                      .body(
                          """
                          {
                            "source_wallet_id": "wallet_001",
                            "destination_wallet_id": "wallet_002",
                            "amount": 1000,
                            "currency": "AED"
                          }
                          """)
                      .post("/transfers")
                      .statusCode();
              synchronized (statuses) {
                statuses.add(status);
              }
            } finally {
              latch.countDown();
            }
          });
    }

    latch.await(30, TimeUnit.SECONDS);
    executor.shutdown();

    Assertions.assertThat(statuses).allMatch(s -> s == 200 || s == 201);
    db.assertTransferCount(1);
    db.assertBalance("wallet_001", 9000);
  }

  @Test
  void retryStormDoesNotDoubleDebit(TransferApiClient client, DatabaseVerifier db)
      throws Exception {
    var request = TransferRequestBuilder.aTransfer().amount(2500).build();
    for (int i = 0; i < 5; i++) {
      client.createTransfer(request, "retry-safe-001");
    }
    db.assertTransferCount(1);
    db.assertBalance("wallet_001", 7500);
  }
}
