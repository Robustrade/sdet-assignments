export interface Wallet {
  id: string;
  balance: number;
  currency: string;
}

export interface Transfer {
  id: string;
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: number;
  currency: string;
  reference: string | null;
  status: string;
  idempotency_key: string | null;
  payload_hash: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  transfer_id: string;
  event_type: string;
  payload: string | null;
  created_at: string;
}

export interface OutboxEvent {
  id: string;
  transfer_id: string;
  event_type: string;
  payload: string | null;
  status: string;
  created_at: string;
}

export interface TransferRequest {
  source_wallet_id?: string;
  destination_wallet_id?: string;
  amount?: number;
  currency?: string;
  reference?: string;
}

export const VALID_CURRENCIES = new Set(['AED', 'USD', 'EUR', 'GBP']);
