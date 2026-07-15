# Kulu SDET Take-Home Assignment

## Overview

This project implements a Wallet Transfer Service using Node.js, Express, and SQLite.

The service supports transferring funds between wallets while ensuring data integrity through validations, idempotency handling, audit logging, and automated testing.

---

## Tech Stack

- Node.js
- Express.js
- SQLite
- Jest
- Supertest

---

## Features Implemented

- Wallet Transfer API
- Wallet Balance API
- Repository Pattern
- Service Layer
- SQLite Database
- Audit Events
- Idempotency Support
- Input Validation
- Automated API Tests
- Integration Tests
- Database Persistence Tests
- Concurrency Tests

---

## Project Structure

```
src/
 ├── db/
 ├── repositories/
 ├── routes/
 ├── services/
 ├── app.js
 └── server.js

tests/
 ├── api/
 ├── integration/
 ├── concurrency/
 ├── database/
 ├── builders/
 └── helpers/
```

---

## Installation

```bash
npm install
```

---

## Initialize Database

```bash
node src/db/init.js
```

---

## Start Application

```bash
npm start
```

Application runs on:

```
http://localhost:3000
```

---

## Run Tests

```bash
npm test
```

---

## Sample API

### Transfer Money

**POST**

```
/transfers
```

Headers

```
Idempotency-Key: unique-key
```

Body

```json
{
    "source_wallet_id": "wallet_001",
    "destination_wallet_id": "wallet_002",
    "amount": 500,
    "currency": "AED",
    "reference": "invoice-001"
}
```

---

### Get Wallet

**GET**

```
/wallets/{walletId}
```

Example

```
GET /wallets/wallet_001
```

---

## Test Coverage

The solution includes automated tests for:

- API Tests
- Integration Tests
- Database Persistence
- Concurrency
- Idempotency

All tests are passing successfully.

```
Test Suites: 6 passed
Tests: 9 passed
```

---

## Notes

This implementation follows a layered architecture using:

- Route Layer
- Service Layer
- Repository Layer

The project includes validation, idempotency handling, audit event creation, and automated testing to ensure reliability.