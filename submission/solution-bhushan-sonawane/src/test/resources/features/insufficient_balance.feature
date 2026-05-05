Feature: Insufficient balance handling

  Scenario: Transfer rejected due to insufficient balance
    Given wallet "wallet_001" has 1000 AED
    And wallet "wallet_002" has 500 AED
    When I create a transfer from "wallet_001" to "wallet_002" of 2000 AED with idempotency key "ins-001"
    Then the API response code should be 409
    And no transfer record should exist
    And wallet "wallet_001" balance should remain 1000 AED
    And wallet "wallet_002" balance should remain 500 AED