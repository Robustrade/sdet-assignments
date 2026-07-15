# Wallet Transfer Service Design

## Goal

Implement the smallest possible Wallet Transfer Service that enables a comprehensive end-to-end automation suite.

The focus of this project is validating transactional correctness rather than building a production-grade payment system.

---

# System Overview

```
Client
   │
POST /transfers
   │
Express API
   │
Transfer Service
   │
SQLite Database
```

---

# API Endpoints

## POST /transfers

Creates a wallet transfer.

Request

```json
{
  "source_wallet_id": "wallet_001",
  "destination_wallet_id": "wallet_002",
  "amount": 250,
  "currency": "AED",
  "reference": "invoice_123"
}
```

Header

```
Idempotency-Key
```

---

## GET /wallets/:id

Returns wallet information.

---

## GET /transfers/:id

Returns transfer information.

---

# Database Tables

## wallets

| Column | Description |
|----------|-------------|
| id | Wallet ID |
| balance | Current balance |
| currency | Wallet currency |

---

## transfers

| Column | Description |
|----------|-------------|
| id | Transfer ID |
| source_wallet_id | Source wallet |
| destination_wallet_id | Destination wallet |
| amount | Transfer amount |
| currency | Currency |
| status | SUCCESS / FAILED |
| reference | Business reference |

---

## idempotency_keys

| Column | Description |
|----------|-------------|
| key | Idempotency Key |
| transfer_id | Associated transfer |

---

## audit_events

| Column | Description |
|----------|-------------|
| id | Audit ID |
| transfer_id | Transfer |
| event | CREATED / SUCCESS / FAILED |
| timestamp | Event time |

---

# Business Invariants

The following conditions must always remain true.

- Source wallet debited exactly once.
- Destination wallet credited exactly once.
- Duplicate requests never create duplicate transfers.
- Failed transfers never modify balances.
- Database state always matches API response.
- Audit records remain consistent.

---

# Planned Test Coverage

## API

- Happy path
- Validation
- Invalid wallet
- Invalid amount

## Business

- Successful transfer
- Insufficient balance
- Retry behaviour
- Idempotency

## Database

- Wallet balances
- Transfer persistence
- Audit records
- Idempotency records

## Reliability

- Concurrent transfers
- Duplicate requests
- Race conditions

---

# Assumptions

- SQLite is used for persistence.
- Express provides the REST API.
- The service is intentionally minimal.
- The primary deliverable is the automation suite.