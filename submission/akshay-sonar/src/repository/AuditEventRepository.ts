import { AuditEvent } from "../domain/AuditEvent";
import { InMemoryRepository } from "./InMemoryRepository";

export class AuditEventRepository extends InMemoryRepository<AuditEvent> {
}