package com.wallet.transfer.repository;

import com.wallet.transfer.model.AuditRecord;
import java.util.List;
import java.util.UUID;

public interface AuditRepository {
  AuditRecord save(AuditRecord auditRecord);

  List<AuditRecord> findByTransferId(UUID transferId);

  List<AuditRecord> findAll();

  long countByTransferId(UUID transferId);
}
