package com.kulu.sdet.infra;

import com.kulu.sdet.repo.OutboxRepo;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Relays unpublished outbox rows to the {@link NotifierStub}. Invoked on demand from tests via
 * {@link #drain()}; in production this would be scheduled or event-driven.
 */
@Component
public class OutboxRelay {
  private final OutboxRepo outbox;
  private final NotifierStub notifier;

  public OutboxRelay(OutboxRepo outbox, NotifierStub notifier) {
    this.outbox = outbox;
    this.notifier = notifier;
  }

  @Transactional
  public int drain() {
    int published = 0;
    for (Map<String, Object> row : outbox.findUnpublished(1000)) {
      String aggregate = (String) row.get("aggregate_id");
      String type = (String) row.get("event_type");
      String payload = String.valueOf(row.get("payload"));
      notifier.deliver(aggregate, type, payload);
      outbox.markPublished(((Number) row.get("id")).longValue());
      published++;
    }
    return published;
  }
}
