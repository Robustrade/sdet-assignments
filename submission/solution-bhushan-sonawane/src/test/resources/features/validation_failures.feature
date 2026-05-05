Feature: Validation failures

  Scenario: Transfer rejected for negative amount
    Given wallet "wallet_001" has 5000 AED
    And wallet "wallet_002" has 1000 AED
    When I create a transfer from "wallet_001" to "wallet_002" of -100 AED with idempotency key "val-001"
    Then the API response code should be 400
    And no transfer record should exist
    And wallet "wallet_001" balance should remain 5000 AED
    And wallet "wallet_002" balance should remain 1000 AED

  Scenario: Transfer rejected when source and destination are the same
    Given wallet "wallet_001" has 5000 AED
    When I create a transfer from "wallet_001" to "wallet_001" of 1000 AED with idempotency key "val-002"
    Then the API response code should be 400
    And no transfer record should exist
    And wallet "wallet_001" balance should remain 5000 AED

  Scenario: Transfer rejected for zero amount wallet "wallet_001" has 3000 AED
    And wallet "wallet_002" has 1000 AED
    When I create a transfer from "wallet_001" to "wallet_002" of 0 AED with idempotency key "val-zero-001"
    Then the API response code should be 400
    And no transfer record should exist
    And wallet "wallet_001" balance should remain 3000 AED
    And wallet "wallet_002" balance should remain 1000 AED

  Scenario: Transfer rejected for unknown destination wallet
    Given wallet "wallet_001" has 3000 AED
    When I create a transfer from "wallet_001" to "wallet_unknown" of 500 AED with idempotency key "val-unknown-001"
    Then the API response code should be 404
    And no transfer record should exist
    And wallet "wallet_001" balance should remain 3000 AED