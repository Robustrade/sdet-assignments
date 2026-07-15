package com.kulu.sdet.infra;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * In-process stand-in for a downstream notification/analytics consumer.
 *
 * <p>Counts invocations per (aggregate_id, event_type) so tests can assert that outbox delivery is
 * exactly-once from the perspective of the downstream consumer.
 */
@Component
public class NotifierStub {
  private final Map<String, Integer> calls = new ConcurrentHashMap<>();

  public void deliver(String aggregateId, String eventType, String payload) {
    calls.merge(aggregateId + "|" + eventType, 1, Integer::sum);
  }

  public int callsFor(String aggregateId, String eventType) {
    return calls.getOrDefault(aggregateId + "|" + eventType, 0);
  }

  public void reset() {
    calls.clear();
  }
}
