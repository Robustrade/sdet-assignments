package com.wallet.transfer.repository;

import com.wallet.transfer.model.OutboxEvent;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.stream.Collectors;

public class InMemoryOutboxRepository implements OutboxRepository {
  private final ConcurrentMap<UUID, OutboxEvent> events = new ConcurrentHashMap<>();

  @Override
  public OutboxEvent save(OutboxEvent outboxEvent) {
    events.put(outboxEvent.eventId(), outboxEvent);
    return outboxEvent;
  }

  @Override
  public Optional<OutboxEvent> findById(UUID eventId) {
    return Optional.ofNullable(events.get(eventId));
  }

  @Override
  public List<OutboxEvent> findUnpublished() {
    return events.values().stream().filter(e -> !e.published()).collect(Collectors.toList());
  }

  @Override
  public List<OutboxEvent> findAll() {
    return new ArrayList<>(events.values());
  }

  @Override
  public long countByAggregateId(String aggregateId) {
    return events.values().stream().filter(e -> e.aggregateId().equals(aggregateId)).count();
  }

  public void clear() {
    events.clear();
  }
}
