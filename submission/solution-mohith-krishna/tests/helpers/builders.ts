import { v4 as uuidv4 } from 'uuid';

export interface TransferPayload {
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: number;
  currency: string;
  reference?: string;
}

export function buildTransferPayload(overrides: Partial<TransferPayload> = {}): TransferPayload {
  return {
    source_wallet_id: 'wallet_001',
    destination_wallet_id: 'wallet_002',
    amount: 2500,
    currency: 'AED',
    reference: 'invoice_123',
    ...overrides,
  };
}

export function buildIdempotencyKey(): string {
  return uuidv4();
}
