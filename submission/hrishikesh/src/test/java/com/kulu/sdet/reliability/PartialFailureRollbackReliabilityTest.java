package com.kulu.sdet.reliability;

import static com.kulu.sdet.support.WalletApiClient.transferBody;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;

import com.kulu.sdet.repo.OutboxRepo;
import com.kulu.sdet.support.ApiTestBase;
import com.kulu.sdet.support.builders.IdemKey;
import io.restassured.response.Response;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.SpyBean;

/**
 * Fault-injection proof of transactional rollback.
 *
 * <p>Forces the last write inside {@code TransferService.execute()} — the outbox enqueue — to throw
 * a {@link RuntimeException} on its first invocation. The whole {@code @Transactional} method must
 * roll back atomically:
 *
 * <ul>
 *   <li>wallet balances must be unchanged,
 *   <li>no row must exist in {@code transfers},
 *   <li>no row must exist in {@code transfer_events},
 *   <li>no row must exist in {@code outbox_events},
 *   <li>and — critically — no row must exist in {@code idempotency_keys} either, so a subsequent
 *       retry with the same key can proceed normally rather than being permanently "poisoned" by a
 *       half-written placeholder.
 * </ul>
 *
 * <p>Then the same request is retried without fault injection and must succeed cleanly. This proves
 * the retry-recovery contract that clients depend on: a 5xx from us is a *safe* failure — they may
 * retry with the same key without side effects and without being locked out.
 *
 * <p>This is the one test in the suite that uses a Mockito spy. Every other test drives real
 * components; here a spy is the only way to inject a failure at a precise instruction inside the
 * transaction without adding a production-only feature flag.
 */
class PartialFailureRollbackReliabilityTest extends ApiTestBase {

  @SpyBean @Autowired OutboxRepo outboxSpy;

  @Test
  void faultDuringOutboxEnqueueRollsBackEveryTableIncludingIdempotencyPlaceholder() {
    seedWallet("wallet_a", 10_000);
    seedWallet("wallet_b", 0);
    String key = IdemKey.fresh();
    Map<String, Object> body = transferBody("wallet_a", "wallet_b", 1_500, "AED", "invoice_pf");

    // Fail the first outbox enqueue only; subsequent calls delegate to the real method.
    doThrow(new RuntimeException("simulated broker unavailable"))
        .doCallRealMethod()
        .when(outboxSpy)
        .enqueueIfAbsent(anyString(), anyString(), anyString());

    // First attempt: server-side exception must produce a 5xx.
    Response failed = api.postTransfer(key, body);
    assertThat(failed.statusCode())
        .as("server must surface transactional failure as 5xx, not a silent success")
        .isBetween(500, 599);

    // Every table must be in its pre-request state.
    assertThat(db.balanceOf("wallet_a")).as("source balance unchanged").isEqualTo(10_000L);
    assertThat(db.balanceOf("wallet_b")).as("destination balance unchanged").isEqualTo(0L);
    assertThat(db.transferCountForIdempotencyKey(key))
        .as("no transfer row for this key")
        .isEqualTo(0);
    assertThat(db.idempotencyRowCount(key))
        .as(
            "idempotency placeholder must roll back — otherwise the client is locked out of"
                + " retrying with the same key")
        .isEqualTo(0);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM transfer_events", Integer.class))
        .as("no audit rows")
        .isEqualTo(0);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM outbox_events", Integer.class))
        .as("no outbox rows")
        .isEqualTo(0);

    // Retry the exact same request — the second outbox call is the real method now, so this must
    // succeed cleanly and produce exactly one set of side effects.
    Response retry = api.postTransfer(key, body);
    assertThat(retry.statusCode()).as("retry after rollback proceeds cleanly").isEqualTo(201);
    String transferId = retry.jsonPath().getString("id");

    assertThat(db.balanceOf("wallet_a")).isEqualTo(8_500L);
    assertThat(db.balanceOf("wallet_b")).isEqualTo(1_500L);
    assertThat(db.transferCountForIdempotencyKey(key)).isEqualTo(1);
    assertThat(db.idempotencyRowCount(key)).isEqualTo(1);
    assertThat(db.auditCount(transferId, "transfer_completed")).isEqualTo(1);
    assertThat(db.outboxCount(transferId)).isEqualTo(1);

    // Cleanup: reset the spy so a subsequent test in the same context is unaffected.
    reset(outboxSpy);
  }
}
