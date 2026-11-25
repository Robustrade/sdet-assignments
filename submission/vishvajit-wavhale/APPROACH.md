\# Kulu SDET Assignment — Implementation Approach



\## 1. Understanding of the Assignment



The objective is to build a maintainable, object-oriented automated validation solution for a Subscription \& Billing Service.



The solution will validate subscription lifecycle behavior across API, business logic, persistence, and external payment-provider integration.



The main focus areas are:

\- Correct subscription lifecycle transitions.

\- API request and response validation.

\- Database consistency across lifecycle operations.

\- Duplicate and out-of-order webhook handling.

\- Payment-provider success, decline, and timeout scenarios.

\- Idempotency and resilience against repeated requests.



\## 2. Proposed Architecture



The solution will use TypeScript with a layered structure:



\- \*\*API layer:\*\* Express endpoints and request validation.

\- \*\*Domain layer:\*\* Subscription lifecycle state machine.

\- \*\*Service layer:\*\* Subscription and webhook business workflows.

\- \*\*Repository layer:\*\* Encapsulated database operations.

\- \*\*Payment layer:\*\* Payment provider interface and mock implementation.

\- \*\*Test framework:\*\* Reusable API clients, fixtures, builders, assertions, and scenario-based tests.



\## 3. OOP and Design Patterns



The implementation will use patterns where they provide practical value:



\- \*\*State Machine:\*\* Centralizes valid subscription transitions and prevents invalid lifecycle changes.

\- \*\*Builder:\*\* Creates reusable customer, subscription, and webhook test data.

\- \*\*Strategy / Dependency Injection:\*\* Allows the payment provider to be replaced with a mock implementation.

\- \*\*Repository:\*\* Separates persistence operations from business logic.

\- \*\*Factory / Fixture:\*\* Provides consistent test dependencies and setup.



\## 4. Test Strategy



Validation will cover multiple levels:



\- Unit tests for domain rules and individual services.

\- API tests for request validation, response contracts, and error handling.

\- Integration tests for service, repository, and database interactions.

\- Workflow tests for complete subscription lifecycle scenarios.

\- Resilience tests for duplicate events, stale events, payment failures, and retries.



SQLite will provide the test persistence layer. The payment provider will be simulated through an injectable mock; no real payment gateway will be called.



\## 5. Data Consistency and Reliability



Tests will compare API-visible results with persisted database state.



The validation will cover subscription records, invoices, payment attempts, webhook events, and audit history.



Duplicate webhook delivery and retry behavior will be tested to verify idempotency and prevent unintended state changes or duplicate side effects.



\## 6. Validation and Documentation



The solution will include documented setup instructions, architecture decisions, test strategy, API contracts, test scenarios, and known limitations.



Local validation will include TypeScript compilation, linting, automated tests, and coverage reporting.



\## 7. Scope and Trade-offs



This is a focused test fixture and automation solution rather than a production payment platform.



External payment processing will be mocked. Any assumptions around concurrency, provider idempotency, webhook ordering, and retry behavior will be documented explicitly.

