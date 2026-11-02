# Kulu SDET Take-Home Assignment

This repository contains the take-home infrastructure assignment for SDET engineering candidates at Kulu.

## Language

Solutions must be written in **TypeScript** (plain JavaScript is acceptable with a strong reason — see [SDET_ASSIGNMENT.md](./SDET_ASSIGNMENT.md)).

## How to Submit

1. Fork this repository to your own GitHub account.
2. Complete the assignment described in [SDET_ASSIGNMENT.md](./SDET_ASSIGNMENT.md).
3. Raise a Pull Request back to this repository (`main` branch) with your full solution, under `submission/<your-name>/`.
4. Your PR branch should be named: `solution/<your-name>` (e.g., `solution/jane-doe`).
5. Fill out the PR description using [`pull_request_template_sdet.md`](./pull_request_template_sdet.md).

## Local validation

The submission is a minimal TypeScript HTTP fixture and automated test suite.
From the submission directory, install the development dependencies and run:

```sh
cd submission/chita-ranjan-mishra
npm ci
npm test
npm run typecheck
```

The fixture uses Node's built-in HTTP and test modules and an isolated in-memory
repository; it does not call a real payment provider or require a database.
See [`submission/chita-ranjan-mishra/TEST_STRATEGY.md`](./submission/chita-ranjan-mishra/TEST_STRATEGY.md)
for the assumptions, scope, design, and known limitations.
