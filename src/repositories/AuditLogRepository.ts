import { AuditLog } from "../domain/AuditLog";

export interface AuditLogRepository {
  save(log: AuditLog): void;

  getAll(): AuditLog[];
}