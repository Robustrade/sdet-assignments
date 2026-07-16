package com.wallet.transfer.repository;

import com.wallet.transfer.model.AuditRecord;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.stream.Collectors;

public class InMemoryAuditRepository implements AuditRepository {
  private final ConcurrentMap<UUID, AuditRecord> audits = new ConcurrentHashMap<>();

  @Override
  public AuditRecord save(AuditRecord auditRecord) {
    audits.put(auditRecord.id(), auditRecord);
    return auditRecord;
  }

  @Override
  public List<AuditRecord> findByTransferId(UUID transferId) {
    return audits.values().stream()
        .filter(a -> a.transferId().equals(transferId))
        .collect(Collectors.toList());
  }

  @Override
  public List<AuditRecord> findAll() {
    return new ArrayList<>(audits.values());
  }

  @Override
  public long countByTransferId(UUID transferId) {
    return audits.values().stream().filter(a -> a.transferId().equals(transferId)).count();
  }

  public void clear() {
    audits.clear();
  }
}
