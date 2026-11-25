
# Test Scenario Matrix

## Subscription API

| ID | Scenario | Expected Result |
|---|---|---|
| SUB-001 | Create trial subscription | Status trialing |
| SUB-002 | Create immediate charge subscription | Payment initiated |
| SUB-003 | Get existing subscription | HTTP 200 |
| SUB-004 | Get unknown subscription | HTTP 404 |
| SUB-005 | Create with invalid plan | Rejected |
| SUB-006 | Create with unknown customer | Rejected |
| SUB-007 | Create without payment method | Rejected |
| SUB-008 | Cancel active subscription | Status canceled |
| SUB-009 | Cancel trial subscription | Status canceled |
| SUB-010 | Cancel already canceled subscription | Rejected |

## Payment Lifecycle

| ID | Scenario | Expected Result |
|---|---|---|
| PAY-001 | First payment succeeds | trialing -> active |
| PAY-002 | First payment fails | trialing -> past_due |
| PAY-003 | Recurring payment fails | active -> past_due |
| PAY-004 | Retry payment succeeds | past_due -> active |
| PAY-005 | Retry attempts exhausted | past_due -> canceled |
| PAY-006 | Provider timeout | No false success |

## Webhook Validation

| ID | Scenario | Expected Result |
|---|---|---|
| WH-001 | Valid signature | Accepted |
| WH-002 | Invalid signature | HTTP 401 |
| WH-003 | Missing signature | HTTP 401 |
| WH-004 | Malformed payload | HTTP 400 |
| WH-005 | Duplicate event ID | No duplicate side effects |
| WH-006 | Success then failure for same invoice | Remains active |
| WH-007 | Success webhook after cancellation | Remains canceled |
| WH-008 | Unknown event type | Rejected safely |

## State Machine

| ID | Transition | Expected |
|---|---|---|
| SM-001 | trialing -> active | Allowed |
| SM-002 | trialing -> past_due | Allowed |
| SM-003 | active -> past_due | Allowed |
| SM-004 | past_due -> active | Allowed |
| SM-005 | past_due -> canceled | Allowed |
| SM-006 | active -> canceled | Allowed |
| SM-007 | trialing -> canceled | Allowed |
| SM-008 | canceled -> active | Rejected |
| SM-009 | canceled -> past_due | Rejected |
| SM-010 | active -> trialing | Rejected |

## Database Validation

| ID | Scenario | Validation |
|---|---|---|
| DB-001 | Subscription creation | Subscription persisted |
| DB-002 | Successful payment | Successful invoice persisted |
| DB-003 | Failed payment | Failed invoice persisted |
| DB-004 | Duplicate webhook | One business processing result |
| DB-005 | Cancellation | Canceled state persisted |
| DB-006 | Audit history | Events recorded correctly |

## Payment Provider

| ID | Scenario | Validation |
|---|---|---|
| PP-001 | Successful charge | Correct arguments |
| PP-002 | Declined charge | Correct failure handling |
| PP-003 | Timeout | No false activation |
| PP-004 | Invalid subscription creation | Zero provider calls |
| PP-005 | Replayed webhook | No extra provider call |
