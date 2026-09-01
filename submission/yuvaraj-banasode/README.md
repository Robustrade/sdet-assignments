# Submission: yuvaraj-banasode

This folder contains the final submission for the SDET assignment.

## What is included

- Automated validation suite for the Subscription & Billing Service
- Minimal in-memory service fixture and mock payment provider
- Persistence and webhook idempotency verification
- PR-ready description in the project’s required template format

## Prerequisites

- Node.js 18+ recommended
- npm installed with Node

## Run locally from a clean setup

From the project root:

```bash
cd "C:\Users\Expinte Technologies\Downloads\Assignment\submission\yuvaraj-banasode"
npm install
npm test -- --runInBand
```

If you are already inside the folder, the shorter version is:

```bash
npm install
npm test -- --runInBand
```

## Helpful commands

```bash
npm test -- --runInBand
npm test -- --watch
npm test -- --coverage
```

## Validation status

The current workspace passes the Jest suite locally with 51/51 tests passing.
