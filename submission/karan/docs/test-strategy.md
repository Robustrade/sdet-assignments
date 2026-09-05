# Test Strategy

The suite is organized around **business scenarios**, with reusable automation infrastructure kept under `tests/framework/`.

- `tests/framework/clients/` provides the typed HTTP client used by API-facing scenarios.
- `tests/framework/builders/` centralizes repeated request, invoice, customer, and signed-webhook construction.
- `tests/framework/assertions/` contains persistence and provider invariant checks so individual scenarios stay focused on behavior.
- `tests/conftest.py` wires an isolated in-memory SQLite database and a fresh mock provider into each test.
- `tests/scenarios/` contains the executable business-facing specifications.

The suite deliberately combines API, service workflow, database persistence, and provider interaction in the same scenarios where the behavior crosses those boundaries. Direct state-machine tests are kept small and focused so invalid lifecycle transitions can be verified independently as well.

For the scenario-to-assignment mapping, see [`coverage-matrix.md`](coverage-matrix.md).
