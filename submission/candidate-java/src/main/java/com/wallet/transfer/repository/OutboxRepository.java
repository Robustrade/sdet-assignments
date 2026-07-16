package com.wallet.transfer.repository;

import com.wallet.transfer.model.OutboxEvent;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OutboxRepository {
  OutboxEvent save(OutboxEvent outboxEvent);

  Optional<OutboxEvent> findById(UUID eventId);

  List<OutboxEvent> findUnpublished();

  List<OutboxEvent> findAll();

  long countByAggregateId(String aggregateId);
}
