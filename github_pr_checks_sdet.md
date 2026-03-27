# GitHub PR Checks for the Wallet Transfer SDET Assignment

Use the following checks as **required status checks** on the repository branch protection rules.

## Recommended Required Checks

### 1. `lint`
Purpose:
- enforce formatting and baseline code quality

Examples:
```bash
ruff check .
black --check .
```

Or equivalent for your language stack.

### 2. `unit-and-integration-tests`
Purpose:
- run the automation suite
- validate API, database, and component-level checks

Examples:
```bash
pytest -q
```

### 3. `db-migration-or-schema-check`
Purpose:
- ensure test database schema or fixtures are valid and reproducible

Examples:
```bash
python scripts/validate_schema.py
```

### 4. `reliability-tests`
Purpose:
- run idempotency, duplicate, and concurrency-focused tests

Examples:
```bash
pytest -q -m reliability
```

### 5. `security-and-secrets-scan`
Purpose:
- catch secrets and obvious issues in test harness code

Examples:
```bash
bandit -r .
gitleaks detect --no-banner --redact
```

### 6. `docs-check`
Purpose:
- ensure README and required docs exist and are not obviously broken

Examples:
```bash
test -f README.md
test -f ASSIGNMENT.md || true
```

---

## Nice-to-Have Checks

### `e2e-smoke`
- bring up local test dependencies
- execute one happy-path transfer
- verify DB state and side effects

### `contract-check`
- validate API response schema and request contract assumptions

### `container-build`
- build the test runner or service fixture image if containerized

---

## Branch Protection Recommendation

Set the following as required before merge:

- `lint`
- `unit-and-integration-tests`
- `db-migration-or-schema-check`
- `reliability-tests`
- `security-and-secrets-scan`

Optionally require:
- at least 1 reviewer approval
- conversation resolution
- up-to-date branch before merge

---

## Reviewer Checklist for PR Template

### Required PR Description Sections

- Summary of what was implemented
- Test strategy
- API validation approach
- Database validation approach
- Cross-component validation
- Reliability/concurrency coverage
- Test architecture
- Validation steps run locally
- Known limitations / next steps
- Responsible AI usage disclosure

### Author Checklist

- [ ] Linting passes locally
- [ ] Test suite passes locally
- [ ] Schema/setup validation passes
- [ ] Reliability-focused tests pass
- [ ] README/setup steps were tested from a clean state
- [ ] End-to-end transfer validation was run locally
- [ ] AI usage disclosed in PR description if used

---

## Minimum Practical Baseline

If you want the leanest useful setup, start with these 4 blocking checks:

1. Lint/format checks
2. Main automation suite
3. Schema/setup validation
4. Reliability/idempotency/concurrency tests

That is the smallest set that still gives good automatic PR review signal for this assignment.
