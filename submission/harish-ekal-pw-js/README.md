# Subscription Billing Automation Framework (JavaScript + Playwright)

A object-oriented test framework for validating a stateful Subscription & Billing backend.

## What this is

This repo includes:

- a minimal service fixture (Express + in-memory persistence)
- a mockable payment provider seam
- an API-focused Playwright test suite
- persistence and workflow/state-machine assertions

The goal is **test architecture and correctness**, not product completeness.

## Run

```bash
npm test
```

Tests run sequentially (1 worker) so output appears in order.

## Reports

This project produces both built-in Playwright HTML output and Allure HTML reports on every test run.

### Test commands

- Run tests (default): `npm test`
- Run tests for dev environment: `npm run test:dev`
- Run tests for stage environment: `npm run test:stage`
- Run tests for prod environment: `npm run test:prod`

### Report commands

- Open Playwright HTML report: `npm run report:html`
- Generate and open Allure report (default env): `npm run report:allure`
- Generate and open Allure report for dev: `npm run report:allure:dev`
- Generate and open Allure report for stage: `npm run report:allure:stage`
- Generate and open Allure report for prod: `npm run report:allure:prod`

### Artifacts

- Playwright HTML: `playwright-report/`
- Allure results (raw data): `allure-results/`
- Allure HTML (current report): `allure-report/`
- Environment config: `allure-results/environment.properties`

### Notes

- Environment is displayed in the Allure report header
- Each test run updates the environment.properties file based on the command used
- A maintained, direct Extent reporter package for Playwright JS was not available; Allure is configured as the rich UI reporter
