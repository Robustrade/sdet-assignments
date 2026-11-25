Assumptions
The solution uses an in-memory persistence layer.
The payment provider is mocked.
Subscription lifecycle is represented using a state machine.
Event IDs are used for webhook idempotency.
Architecture
The solution is structured into:

domain
repositories
providers
state-machine
webhook
services
tests
Design Patterns
State Machine
Used to enforce valid subscription lifecycle transitions.

Repository
Used to abstract persistence access.

Builder
Used to create test data fluently.

Strategy / Dependency Injection
Used to abstract the payment provider implementation.

Test Strategy
The solution validates:

API behavior
Lifecycle transitions
Persistence behavior
Webhook processing
Payment provider interactions
Persistence Strategy
Persistence is implemented using in-memory repositories.

Webhook Strategy
The solution verifies:

Valid signatures
Invalid signatures
Duplicate deliveries
Out-of-order delivery
Idempotency
Processed event IDs are stored and checked before processing.

Limitations
In-memory persistence
Simplified webhook signature validation
Minimal service fixture
Future Improvements
Replace in-memory repositories with SQLite/PostgreSQL
Add concurrent webhook tests
Add real HMAC signature validation
