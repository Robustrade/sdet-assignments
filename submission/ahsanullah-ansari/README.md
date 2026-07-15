# Ahsanullah Ansari — SDET Assignment Submission

**Status:** WIP — Step 1 of the documentation-first workflow.

This PR currently contains only the **test strategy** (`STRATEGY.md`).
Implementation (service fixture + automation suite) will land as additional commits on this same branch (`solution/ahsanullah-ansari`), then the PR will be moved from draft → ready-for-review.

## Read this first

→ [`STRATEGY.md`](./STRATEGY.md) — the full validation strategy, scope, coverage matrix, invariants, and architecture.

## Coming next (in follow-up commits)

- `service/` — minimal FastAPI + SQLAlchemy wallet-transfer fixture (real Postgres via Testcontainers)
- `tests/` — pytest suite structured in five layers (fixtures, API client, assertions, scenarios, builders)
- `scripts/validate_schema.py` — matches the evaluation-guide expectation
- `pyproject.toml`, `requirements.txt` — so the existing CI Python workflow picks it up automatically
- A populated PR description using the repository's `pull_request_template_sdet.md`

## Run instructions

To be added in the next commit alongside the automation code.
