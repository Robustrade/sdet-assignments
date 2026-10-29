import type { IdempotencyRepository, IdempotencyReservation } from './IdempotencyRepository';

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly rows = new Map<string, IdempotencyReservation>();

  async find(key: string): Promise<IdempotencyReservation | undefined> {
    const row = this.rows.get(key);
    return row ? { ...row } : undefined;
  }

  async save(reservation: IdempotencyReservation): Promise<void> {
    this.rows.set(reservation.key, { ...reservation });
  }
}
