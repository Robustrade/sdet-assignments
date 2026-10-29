/**
 * Remembers which subscription a creation `Idempotency-Key` belongs to.
 * A reservation is written BEFORE the provider is charged, so a retry after a timeout
 * (nothing else persisted) still resolves to the same subscription id and provider key.
 */
export interface IdempotencyReservation {
  readonly key: string;
  /** Digest of the request that first used the key; a different request must not reuse it. */
  readonly fingerprint: string;
  readonly subscriptionId: string;
}

export interface IdempotencyRepository {
  find(key: string): Promise<IdempotencyReservation | undefined>;
  save(reservation: IdempotencyReservation): Promise<void>;
}
