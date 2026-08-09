-- ============================================================
-- Wallet Transfer Service — Seed Data
-- ============================================================

-- Clear existing data (for repeatable test runs)
TRUNCATE outbox_events, transfer_events, transfers, idempotency_keys, wallets RESTART IDENTITY CASCADE;

-- Seed wallets
INSERT INTO wallets (id, owner_name, balance, currency) VALUES
    ('wallet_alice',   'Alice',   10000.00, 'AED'),
    ('wallet_bob',     'Bob',      5000.00, 'AED'),
    ('wallet_charlie', 'Charlie',  1000.00, 'AED'),
    ('wallet_empty',   'Empty',       0.00, 'AED');

