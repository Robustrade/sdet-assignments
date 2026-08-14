# Subscription & Billing Service - SDET Assignment

## Overview

This repository contains my submission for the Kulu Software Developer in Test (SDET) take-home assignment.

The objective of this project is to demonstrate the design of a maintainable, object-oriented automated test solution for a Subscription & Billing Service.

The focus is on validating business behaviour rather than implementing a production-ready billing platform.

---

## Technology Stack

- TypeScript
- Node.js
- Express
- Jest
- Supertest
- SQLite (better-sqlite3)

---

## Project Structure

```
submission/vikram-sharma
│
├── docs
│   ├── architecture.md
│   └── test-strategy.md
│
├── src
│   ├── api
│   ├── builders
│   ├── database
│   ├── models
│   ├── payment
│   ├── repositories
│   ├── services
│   └── state-machine
│
├── tests
│   ├── api
│   ├── e2e
│   ├── persistence
│   ├── state-machine
│   └── webhook
│
├── package.json
├── tsconfig.json
└── jest.config.js
```

---

## Design Patterns

The solution intentionally applies the following design patterns:

- State Pattern
- Builder Pattern
- Repository Pattern
- Strategy Pattern

These patterns were selected to improve maintainability and testability rather than simply to satisfy assignment requirements.

---

## Test Coverage

The automated suite validates:

- API contracts
- Subscription lifecycle
- State transitions
- Database persistence
- Webhook processing
- Duplicate webhook handling
- Payment provider interactions
- End-to-end subscription workflow

---

## Running the Project

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

---

## Assumptions

- A minimal backend service fixture is implemented.
- SQLite is used for persistence.
- The payment provider is fully mocked.
- The focus is on automation architecture and validation.

---

## Limitations

The following features are intentionally out of scope:

- Authentication
- Authorization
- Production deployment
- Multi-currency support
- Tax calculations
- Performance testing