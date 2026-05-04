# Wallet Transfer Test Suite

## Coverage

- API validation
- Idempotency validation
- Concurrency testing
- Database consistency
- Invariant validation

## Key Invariants

- No double debit
- Balance conservation
- Exactly-once transfer creation

## Run

mvn clean test