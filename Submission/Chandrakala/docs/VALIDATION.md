# Executed validation

Environment: Windows, Node.js v22.16.0. No live payment provider or production database was contacted.

## Red

Before the lifecycle guard was implemented, `tests/red-regression.mjs` asserted that canceled + paid must throw. With an initial implementation returning its input state, this command failed:

```sh
node --experimental-strip-types --test tests/red-regression.mjs
```

Observed: 1 test, 0 passed, 1 failed; `AssertionError: Missing expected exception.`

## Blue

Added the explicit lifecycle table and exception guard. Rerunning the command above passed: 1 test, 1 passed. A transient native-TypeScript parameter-property parsing error was corrected by declaring the DomainError field explicitly. The regression remains runnable.

## Green and broader validation

Added/refined the HTTP adapter, repository, builders, provider interface/double, clock, API client and reusable verifier. The first full integration run exposed an INSERT placeholder count mismatch; corrected it and reran the complete suite.

```sh
node --experimental-transform-types --test --test-reporter=spec tests/lifecycle.test.ts tests/contracts.test.ts tests/workflows.test.ts tests/webhooks.test.ts tests/persistence.test.ts
```

Observed: **79 tests, 79 passed, 0 failed, 0 canceled, 0 skipped**.

| File | Tests | Evidence |
| --- | ---: | --- |
| contracts.test.ts | 21 | Response shape, validation, trial boundary, plan changes, no unwanted writes/calls |
| lifecycle.test.ts | 16 | Independent 4 x 4 transition oracle: seven valid, nine invalid |
| workflows.test.ts | 8 | Provider success/decline/timeout, full lifecycle, exhaustion, cancellation, in-flight attempt reuse |
| webhooks.test.ts | 31 | Signatures, malformed payloads, replay, conflicting IDs, ordering, refund, concurrent duplicates |
| persistence.test.ts | 3 | Atomic rollback, uniqueness constraint, durable reopen/deduplication |

## Coverage

```sh
node --experimental-transform-types --experimental-test-coverage --test --test-reporter=spec --test-coverage-include=src/** tests/lifecycle.test.ts tests/contracts.test.ts tests/workflows.test.ts tests/webhooks.test.ts tests/persistence.test.ts
```

Observed source-only Node coverage: **98.88% lines, 99.44% branches, 100% functions**. Domain type-only lines were reported uncovered. Treat these figures as supporting evidence: native TypeScript transformation/source accounting may differ from a compiler-based coverage pipeline. Behavioral assertions and independent business expectations provide the main evidence.

## Not verified

- `tsc --noEmit`: compiler/declarations unavailable because npm registry downloads timed out, including an approved retry. Native runtime transformation is not static type checking.
- No existing production service, real provider, CI environment, other Node majors, or multi-process deployment was tested.
- No PR exists: no assignment Git remote was supplied; the parent directory is an SVN workspace.

No checks above imply that a candidate has personally reviewed the AI-assisted submission. That review should happen before submitting it.
