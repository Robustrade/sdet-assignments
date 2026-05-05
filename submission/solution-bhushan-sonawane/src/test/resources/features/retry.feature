Feature: Retry safety

  Scenario: Client safely retries transfer after response loss
    Given wallet "wallet_001" has 3000 AED
    And wallet "wallet_002" has 1000 AED
    When I create a transfer from "wallet_001" to "wallet_002" of 500 AED with idempotency key "retry-001"
    When I create a transfer from "wallet_001" to "wallet_002" of 500 AED with idempotency key "retry-001"
    Then exactly one transfer record should exist
    And wallet "wallet_001" balance should be 2500 AED via API
    And wallet "wallet_002" balance should be 1500 AED via API