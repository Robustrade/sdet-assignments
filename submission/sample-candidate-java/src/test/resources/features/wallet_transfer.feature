Feature: Wallet Transfer Service Validation
  As a user of the wallet service
  I want to securely transfer funds between wallets
  So that balances are updated consistently without duplicates

  Background:
    Given the database is clean and test wallets are seeded
    And wallet "wallet_001" has a balance of 5000 AED
    And wallet "wallet_002" has a balance of 1000 AED

  # Category A: Happy Path Transfer & Category F: Persistence
  Scenario: Successful wallet transfer updates balances and persists correctly
    When a transfer request is made to move 2500 AED from "wallet_001" to "wallet_002" with idempotency key "key-123"
    Then the API response status should be 200
    And the transfer status in the response should be "SUCCESS"
    And the database should reflect exactly one transfer record for "key-123"
    And the database balance for "wallet_001" should exactly decrease by 2500
    And the database balance for "wallet_002" should exactly increase by 2500
    And exactly one outbox event should be emitted

  # Category B: Validation Failures
  Scenario Outline: Transfer rejected due to invalid payload parameters
    When a transfer request is made to move <amount> "<currency>" from "<source>" to "<destination>" with idempotency key "key-invalid-test"
    Then the API response status should be 400
    And the database balances for both wallets should remain unchanged
    And no invalid success record should be created in the database

    Examples:
      | amount | currency | source     | destination | description                  |
      | -500   | AED      | wallet_001 | wallet_002  | Negative amount              |
      | 0      | AED      | wallet_001 | wallet_002  | Zero amount                  |
      | 100    | XXX      | wallet_001 | wallet_002  | Invalid currency             |
      | 500    | AED      | wallet_001 | wallet_001  | Source and destination match |

  # Category C: Insufficient Balance
  Scenario: Transfer rejected due to insufficient balance
    When a transfer request is made to move 10000 AED from "wallet_001" to "wallet_002" with idempotency key "key-124"
    Then the API response status should be 400
    And the transfer should be rejected
    And the database balances for both wallets should remain unchanged
    And no invalid success record should be created in the database

  # Category D: Idempotency / Duplicate Submission
  Scenario: Duplicate submission with the same idempotency key is safely ignored
    When a transfer request is made to move 1000 AED from "wallet_001" to "wallet_002" with idempotency key "key-125"
    And a duplicate transfer request is made with the exact same payload and idempotency key "key-125"
    Then both API responses should return the same logical result
    And the database should reflect only one transfer record for "key-125"
    And the wallets should only be debited and credited exactly once

  # Category E: Concurrency and Race Conditions
  Scenario: Concurrent transfer requests are handled safely
    When 5 concurrent transfer requests are made to move 1500 AED from "wallet_001" to "wallet_002"
    Then the API should process requests until the balance is exhausted
    And the database balance for "wallet_001" should not drop below 0
    And the total balance movement across all wallets should equal the initial sum