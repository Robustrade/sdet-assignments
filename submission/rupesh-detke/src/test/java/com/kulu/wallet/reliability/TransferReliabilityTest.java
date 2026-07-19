package com.kulu.wallet.reliability;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.wallet.support.TestEnvironment;
import com.kulu.wallet.support.TransferRequestBuilder;
import io.restassured.response.Response;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/**
 * Reliability-focused suite intentionally named *Reliability* so CI job `mvn test
 * -Dtest="*Reliability*"` discovers these scenarios.
 */
class TransferReliabilityTest extends TestEnvironment {

  @Test
  void concurrentDuplicateRequestsWithSameIdempotencyKeyDoNotDoubleDebit() throws Exception {
    seedWallet("wallet_001", "AED", 10_000);
    seedWallet("wallet_002", "AED", 0);

    String key = UUID.randomUUID().toString();
    Map<String, Object> body = TransferRequestBuilder.aTransfer().amount(3_000).build();

    List<Response> responses = runConcurrent(8, () -> api.createTransfer(key, body));

    long successOrReplay =
        responses.stream().filter(r -> r.statusCode() == 201 || r.statusCode() == 200).count();
    assertThat(successOrReplay).isEqualTo(8);

    String transferId = responses.get(0).jsonPath().getString("transfer_id");
    assertThat(responses)
        .allSatisfy(r -> assertThat(r.jsonPath().getString("transfer_id")).isEqualTo(transferId));

    db.assertBalances("wallet_001", 7_000, "wallet_002", 3_000);
    db.assertTransferCount(1);
    db.assertIdempotencyCount(1);
    db.assertOutboxCount(1);
  }

  @Test
  void concurrentTransfersCompetingForLimitedBalanceNeverOverdraw() throws Exception {
    seedWallet("wallet_source", "AED", 1_000);
    seedWallet("wallet_dest_a", "AED", 0);
    seedWallet("wallet_dest_b", "AED", 0);

    Map<String, Object> toA =
        TransferRequestBuilder.aTransfer()
            .from("wallet_source")
            .to("wallet_dest_a")
            .amount(800)
            .reference("competing_a")
            .build();
    Map<String, Object> toB =
        TransferRequestBuilder.aTransfer()
            .from("wallet_source")
            .to("wallet_dest_b")
            .amount(800)
            .reference("competing_b")
            .build();

    List<Response> responses =
        runConcurrent(
            2,
            () -> api.createTransfer(UUID.randomUUID().toString(), toA),
            () -> api.createTransfer(UUID.randomUUID().toString(), toB));

    long completed = responses.stream().filter(r -> r.statusCode() == 201).count();
    long rejected = responses.stream().filter(r -> r.statusCode() == 422).count();

    assertThat(completed).isEqualTo(1);
    assertThat(rejected).isEqualTo(1);

    long sourceBalance = db.wallet("wallet_source").balance();
    long destA = db.wallet("wallet_dest_a").balance();
    long destB = db.wallet("wallet_dest_b").balance();

    assertThat(sourceBalance).isGreaterThanOrEqualTo(0);
    assertThat(sourceBalance + destA + destB).isEqualTo(1_000);
    assertThat(destA + destB).isEqualTo(800);
    db.assertOutboxCount(1);
  }

  @SafeVarargs
  private final List<Response> runConcurrent(int threads, Callable<Response>... tasks)
      throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(threads);
    try {
      List<Callable<Response>> work = new ArrayList<>();
      if (tasks.length == 1) {
        for (int i = 0; i < threads; i++) {
          work.add(tasks[0]);
        }
      } else {
        for (Callable<Response> task : tasks) {
          work.add(task);
        }
      }

      List<Future<Response>> futures = pool.invokeAll(work);
      List<Response> responses = new ArrayList<>();
      for (Future<Response> future : futures) {
        responses.add(future.get(30, TimeUnit.SECONDS));
      }
      return responses;
    } finally {
      pool.shutdownNow();
    }
  }
}
