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

## Run & Test

Run the TypeScript type-check:

```bash
npx tsc --noEmit
```

Run the Playwright test suite:

```bash
npx playwright test
```

Open the Playwright HTML report after a run:

```bash
npx playwright show-report
```

Create a PR (example using GitHub CLI):

```bash
gh pr create --base main --head solution/your-name --title "SDET assignment: billing & webhooks" --body "See PR_DESCRIPTION.md for details"
```

Notes:
- The server reads `WEBHOOK_SECRET` from the environment; default is `test_webhook_secret` for local tests.
- CI is configured to run on push/PR and will run `npm run typecheck` and `npm test`.
