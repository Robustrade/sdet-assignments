# Subscription & Billing Service — SDET Assignment

## 1. Overview

This project implements an object-oriented automated validation
solution for a Subscription & Billing Service.

The solution uses a minimal Express service fixture, an SQLite
in-memory database, a mock payment provider and automated API,
workflow and persistence tests.

The focus is on subscription lifecycle correctness, payment
processing, webhook security, idempotency and data consistency.

## 2. Technology Stack

- Node.js
- TypeScript
- Express
- Vitest
- Supertest
- sql.js (SQLite WebAssembly)
- Mock payment provider

## 3. Project Structure

```text
ankit-kumar/
├── src/
│   ├── api/
│   │   └── app.ts
│   ├── application/
│   │   ├── subscription-service.ts
│   │   └── webhook-service.ts
│   ├── domain/
│   │   ├── payment-provider.ts
│   │   └── subscription-state-machine.ts
│   └── infrastructure/
│       ├── database.ts
│       ├── customer-repository.ts
│       ├── subscription-repository.ts
│       ├── invoice-repository.ts
│       ├── webhook-event-repository.ts
│       └── audit-repository.ts
├── tests/
│   ├── builders/
│   │   └── subscription-builder.ts
│   ├── support/
│   │   └── fake-payment-provider.ts
│   └── specs/
├── APPROACH.md
├── package.json
├── package-lock.json
├── tsconfig.json
└── vitest.config.ts