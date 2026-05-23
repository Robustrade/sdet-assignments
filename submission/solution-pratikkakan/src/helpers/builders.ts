import { v4 as uuidv4 } from 'uuid';
import type { TransferRequest } from './api-client';

/** Generates a unique idempotency key for each call. */
export function generateIdempotencyKey(): string {
  return uuidv4();
}

/**
 * Builds a valid TransferRequest.
 * Callers always supply source/dest wallet IDs (seeded fresh per-test);
 * everything else has sensible defaults that can be overridden.
 */
export function buildTransferRequest(
  overrides: Partial<TransferRequest> & {
    source_wallet_id: string;
    destination_wallet_id: string;
  },
): TransferRequest {
  return {
    amount: 1_000,
    currency: 'AED',
    reference: `ref-${uuidv4().slice(0, 8)}`,
    ...overrides,
  };
}
