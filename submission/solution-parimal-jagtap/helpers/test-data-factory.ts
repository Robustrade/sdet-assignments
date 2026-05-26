import { TransferPayload } from './transfer-api-client';

let counter = 0;

export function uniqueRef(): string {
  return `ref_${Date.now()}_${++counter}`;
}

export function idempotencyKey(): string {
  return `idem_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
}

export function validTransfer(overrides: Partial<TransferPayload> = {}): TransferPayload {
  return {
    source_wallet_id: 'wallet_001',
    destination_wallet_id: 'wallet_002',
    amount: 100,
    currency: 'AED',
    reference: uniqueRef(),
    ...overrides,
  };
}

export function smallTransfer(overrides: Partial<TransferPayload> = {}): TransferPayload {
  return validTransfer({ amount: 10, ...overrides });
}
