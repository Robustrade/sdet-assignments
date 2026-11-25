import { AuditLog } from "../domain/AuditLog";
import { AuditLogRepository } from "./AuditLogRepository";

export class InMemoryAuditLogRepository
  implements AuditLogRepository {

  private logs: AuditLog[] = [];

  save(log: AuditLog): void {
    this.logs.push(log);
  }

  getAll(): AuditLog[] {
    return this.logs;
  }
}