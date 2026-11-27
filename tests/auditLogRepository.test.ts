
import { AuditLogRepository } from '../src/repositories/auditLogRepository';

describe('AuditLogRepository', () => {
  let repository: AuditLogRepository;

  const log = {
    id: 'log_1',
    entityType: 'subscription',
    entityId: 'sub_1',
    action: 'created',
    details: 'Subscription created',
    createdAt: new Date(),
  };

  beforeEach(() => {
    repository = new AuditLogRepository();
  });

  test('should save an audit log', () => {
    repository.save(log);
    expect(repository.findById('log_1')).toEqual(log);
  });

  test('should return undefined for unknown log', () => {
    expect(repository.findById('unknown')).toBeUndefined();
  });

  test('should find logs by entity ID', () => {
    repository.save(log);
    expect(repository.findByEntityId('sub_1')).toEqual([log]);
  });

  test('should return all logs', () => {
    repository.save(log);
    expect(repository.findAll()).toEqual([log]);
  });
});
