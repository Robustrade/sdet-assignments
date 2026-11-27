# Subscription & Billing Service — Validation Suite

**Author:** Vedant Dalkari

Object-oriented TypeScript validation framework and hybrid Express + SQLite (`sql.js`) service fixture for the Subscription & Billing domain.

## Prerequisites

- Node.js `>= 20.0.0`
- npm `>= 10.0.0`

## Quick Start

```bash
cd submission/vedant-dalkari
npm install
npm run validate-schema
npm run build
npm run lint
npm test
```

Or run the entire verification pipeline in one command:

```bash
npm run validate
```

## Persistence Setup & Seeding

No external database server or manual seed command is required:

- Every test boots an isolated in-memory SQLite (`sql.js`) database from `src/persistence/schema.sql` with `PRAGMA foreign_keys = ON` and relational constraints across all 6 tables (`customers`, `subscriptions`, `invoices`, `payment_attempts`, `webhook_events`, `subscription_audit_log`).
- Deterministic customer fixtures are seeded automatically via `BillingTestHarness` and `CustomerSpecBuilder`.
- Run `npm run validate-schema` to independently verify DDL execution, column definitions, foreign-key enforcement, and unique/primary-key constraints.

## Documentation

- [Test & Design Strategy](./docs/TEST_STRATEGY.md)

## Engineering & QA Workflow

This suite was designed and verified using a structured, role-separated **agentic QA workflow** (kept outside `submission/vedant-dalkari/` to keep the deliverable tree self-contained):

1. **Contract Test Planning:** Mapped every domain rule, boundary, and failure mode into a traceability plan prior to coding.
2. **Red → Blue → Green Build:** Authored failing object-oriented specs first, implemented the minimal hybrid fixture, and refactored cleanly.
3. **Independent Verification & Guardrail Audit:** Executed `2×` reproducibility runs (`lint`, `tsc`, schema DDL check, `68/68` tests, live HTTP socket probe), static diff hygiene checks, and feature-coverage curation.

## Structure

```text
submission/vedant-dalkari/
├── docs/
│   └── TEST_STRATEGY.md
├── scripts/
│   └── validateSchema.ts
├── src/
│   ├── domain/          # LifecycleEngine (branded transition token), PlanPolicy, types, errors
│   ├── ports/           # BillingGateway, Clock, Notifier interfaces
│   ├── persistence/     # schema.sql, SqliteDatabase (sql.js), repositories
│   ├── services/        # SubscriptionService, BillingEngine, WebhookProcessor
│   └── http/            # Express app + raw-body HMAC signature middleware
└── test/
    ├── framework/
    │   ├── builders/    # CustomerSpecBuilder, SignupPayloadBuilder, SignedWebhookBuilder
    │   ├── clients/     # BillingApiClient, WebhookClient, typed contracts
    │   ├── doubles/     # RecordingBillingGateway, ControlledClock, AuditSpyNotifier, HmacWebhookSigner
    │   ├── env/         # BillingTestHarness factory + seeded fixtures
    │   └── verify/      # LedgerInspector (independent SQL), SubscriptionVerifier, InvariantGuard
    └── specs/
        ├── api/
        ├── lifecycle/
        ├── webhooks/
        ├── provider/
        ├── persistence/
        └── e2e/
```
