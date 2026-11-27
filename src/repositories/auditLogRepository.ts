
export interface AuditLogRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  details: string;
  createdAt: Date;
}

export class AuditLogRepository {
  private logs = new Map<string, AuditLogRecord>();

  save(log: AuditLogRecord): AuditLogRecord {
    this.logs.set(log.id, log);
    return log;
  }

  findById(id: string): AuditLogRecord | undefined {
    return this.logs.get(id);
  }

  findByEntityId(entityId: string): AuditLogRecord[] {
    return Array.from(this.logs.values()).filter(
      log => log.entityId === entityId
    );
  }

  findAll(): AuditLogRecord[] {
    return Array.from(this.logs.values());
  }
}
