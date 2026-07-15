package com.kulu.sdet.reliability;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import io.restassured.response.Response;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Multiple distinct clients competing for a wallet with insufficient balance to satisfy every
 * request. The system must decide winners deterministically: some transfers succeed, the rest are
 * rejected with 422, and the final balance is exactly what the winning transfers dictate — never
 * negative, never over-withdrawn.
 */
class ConcurrentTransfersRaceReliabilityTest extends ApiTestBase {

  @Test
  void competingTransfersNeverOverdrawTheSourceWallet() throws Exception {
    long startBalance = 5_000L;
    long each = 1_000L;
    int workers = 10; // 10 * 1000 = 10_000, but source only has 5_000

    seedWallet("wallet_src", startBalance);
    seedWallet("wallet_dst", 0);

    ExecutorService pool = Executors.newFixedThreadPool(workers);
    CountDownLatch gate = new CountDownLatch(1);
    List<Future<Response>> futures =
        java.util.stream.IntStream.range(0, workers)
            .mapToObj(
                i ->
                    pool.submit(
                        () -> {
                          gate.await(5, TimeUnit.SECONDS);
                          Map<String, Object> body =
                              transferBody(
                                  "wallet_src", "wallet_dst", each, "AED", "concurrent_" + i);
                          return api.postTransfer(IdemKey.fresh(), body);
                        }))
            .collect(Collectors.toList());
    gate.countDown();

    List<Response> responses = new java.util.ArrayList<>();
    for (Future<Response> f : futures) {
      responses.add(f.get(30, TimeUnit.SECONDS));
    }
    pool.shutdownNow();

    long successes = responses.stream().filter(r -> r.statusCode() == 201).count();
    long rejections =
        responses.stream()
            .filter(
                r ->
                    r.statusCode() == 422
                        && "insufficient_balance".equals(r.jsonPath().getString("code")))
            .count();

    assertThat(successes + rejections).isEqualTo(workers);
    // Exactly startBalance / each successes — no more, no fewer.
    assertThat(successes).isEqualTo(startBalance / each);

    long expectedFinalSource = startBalance - successes * each;
    long expectedFinalDest = successes * each;
    assertThat(db.balanceOf("wallet_src")).isEqualTo(expectedFinalSource);
    assertThat(db.balanceOf("wallet_dst")).isEqualTo(expectedFinalDest);
    assertThat(db.balanceOf("wallet_src")).isGreaterThanOrEqualTo(0L);

    Integer transferCount = jdbc.queryForObject("SELECT COUNT(*) FROM transfers", Integer.class);
    assertThat(transferCount).isEqualTo((int) successes);
  }
}
