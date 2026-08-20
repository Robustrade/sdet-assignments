## Summary
Describe what you implemented.

## Test Strategy
- Levels covered:
- In scope:
- Out of scope:
- What is real vs stubbed/mocked, and why:

## OOP & Design Pattern Choices
- Which patterns did you use, and where (file/class)?
- What problem did each one actually solve in your codebase?
- What's the seam around the payment provider (interface, injection point)?

## API Validation Approach
- How are requests/responses validated?
- How is webhook request handling (signature, malformed payload) validated, separately from webhook business logic?
- Which failure scenarios are covered?

## Database Validation Approach
- Which entities are checked (subscriptions, invoices/payments, webhook events, audit log)?
- Which invariants are asserted?
- How is persisted state checked at each lifecycle stage, not just at creation?

## Mock Payment Provider & Webhook Validation
- How is the payment provider mocked, and what do you assert against it (call count, arguments)?
- How is webhook idempotency (duplicate `event_id`) proven?
- How is out-of-order/stale webhook delivery handled and tested?

## State-Machine / Lifecycle Coverage
- Which valid transitions are tested?
- Which invalid transitions are proven impossible?
- What confidence do these tests provide?

## Test Architecture
Explain how the suite is structured (fixtures, API client, mock provider, assertions, scenarios, builders) and why it's maintainable.

## Validation
List the commands or workflows you ran to validate the solution (e.g. `npm test`, `npm run lint`, `npm run build`, `npm run validate-schema`).

## Known Limitations / Next Steps
List tradeoffs, simplifying assumptions, or improvements you would make with more time.

## Responsible AI Usage
- Did you use AI tools?
- Where did they help?
- What did you personally verify or correct?

## Author Checklist
- [ ] Linting passes
- [ ] Type check passes (`npm run build` / `tsc --noEmit`)
- [ ] Test suite passes
- [ ] Schema/setup validation passes
- [ ] Every listed lifecycle transition is exercised by at least one test
- [ ] At least two invalid transitions are proven impossible
- [ ] Webhook idempotency (duplicate `event_id`) is tested
- [ ] README was tested from a clean setup
