# Kulu Subscription & Billing SDET Assignment

This repository contains a small TypeScript service fixture and an HTTP-level validation suite. The implementation exists only to make the test strategy executable; it is an in-memory training fixture, not production billing software.

## Setup and validation

Requires Node.js 20 or newer.

```sh
npm install
npm run validate-schema
npm run build
npm run lint
npm test
```

See [STRATEGY.md](./STRATEGY.md) for assumptions, test boundaries, patterns, persistence checks, invariants, and known limitations. Each test constructs a fresh in-memory repository and a recording payment-provider fake, so tests can be run independently.

## Coverage map

The suite exercises creation and retrieval, plan trial metadata, success/decline/timeout charges, cancellation, API validation, signed and malformed webhooks, duplicate event IDs, stale failure delivery, canceled-subscription protection, and persisted subscription/invoice/event/audit state. For the required PR description, use the repository's supplied template and copy the relevant sections from STRATEGY.md.
