package com.kulu.sdet.reliability;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import io.restassured.response.Response;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/**
 * Concurrent duplicate submissions with the same idempotency key must resolve to exactly one
 * persisted transfer and exactly one set of side effects. Only one of the responses is allowed to
 * carry the "originating" 201; the rest must be treated as replays with an identical body.
 *
 * <p>This is the invariant that catches the most damaging class of bugs — a client double-clicks,
 * both requests race, and the customer is charged twice.
 */
class ConcurrentDuplicateIdempotencyReliabilityTest extends ApiTestBase {

  @Test
  void tenConcurrentDuplicatesProduceExactlyOneTransferAndOneSetOfSideEffects() throws Exception {
    int workers = 10;
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();
    Map<String, Object> body = transferBody("wallet_a", "wallet_b", 1_500, "AED", "invoice_c");

    List<Response> responses = fanOut(workers, () -> api.postTransfer(key, body));

    // All responses must be successful (201 for the winner, 201 replay for the rest).
    assertThat(responses).allMatch(r -> r.statusCode() == 201);

    // Exactly one distinct transfer id across every response.
    List<String> ids =
        responses.stream()
            .map(r -> r.jsonPath().getString("id"))
            .distinct()
            .collect(Collectors.toList());
    assertThat(ids).hasSize(1);
    String transferId = ids.get(0);

    // Persistence-level invariants.
    assertThat(db.transferCountForIdempotencyKey(key)).isEqualTo(1);
    assertThat(db.idempotencyRowCount(key)).isEqualTo(1);
    assertThat(db.auditCount(transferId, "transfer_completed")).isEqualTo(1);
    assertThat(db.outboxCount(transferId)).isEqualTo(1);

    // Balances moved exactly once.
    assertThat(db.balanceOf("wallet_a")).isEqualTo(10_000L - 1_500L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(1_500L);

    // Downstream delivery is exactly-once.
    outboxRelay.drain();
    assertThat(notifier.callsFor(transferId, "TransferCompleted")).isEqualTo(1);
  }

  /** Fire {@code n} identical callables in parallel and collect their results in order. */
  private <T> List<T> fanOut(int n, Callable<T> task) throws Exception {
    ExecutorService pool = Executors.newFixedThreadPool(n);
    try {
      CountDownLatch gate = new CountDownLatch(1);
      List<Future<T>> futures =
          IntStream.range(0, n)
              .mapToObj(
                  i ->
                      pool.submit(
                          () -> {
                            gate.await(5, TimeUnit.SECONDS);
                            return task.call();
                          }))
              .collect(Collectors.toList());
      gate.countDown();
      List<T> results = new java.util.ArrayList<>(n);
      for (Future<T> f : futures) {
        results.add(f.get(30, TimeUnit.SECONDS));
      }
      return results;
    } finally {
      pool.shutdownNow();
    }
  }
}
