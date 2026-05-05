Feature: Idempotency and duplicate submission handling

  Scenario: Same idempotency key with same payload is safely replayed
    Given wallet "wallet_001" has 4000 AED
    And wallet "wallet_002" has 1000 AED
    When I create a transfer from "wallet_001" to "wallet_002" of 1000 AED with idempotency key "idem-conflict-001"
    Then the transfer status should be "SUCCESS"
    And exactly one transfer record should exist
    And wallet "wallet_001" balance should be 3000 AED via API
    And wallet "wallet_002" balance should be 2000 AED via API

  Scenario: Same idempotency key with different payload is rejected
    Given wallet "wallet_001" has 5000 AED
    And wallet "wallet_002" has 1000 AED
    When I create a transfer from "wallet_001" to "wallet_002" of 1000 AED with idempotency key "idem-conflict-001"
    And I create a transfer from "wallet_001" to "wallet_002" of 2000 AED with idempotency key "idem-conflict-001"
    Then the API response code should be 422
    And exactly one transfer record should exist
    And wallet "wallet_001" balance should be 4000 AED via API
    And wallet "wallet_002" balance should be 2000 AED via API

  Scenario: Concurrent retries with same idempotency key
    Given wallet "wallet_001" has 3000 AED
    And wallet "wallet_002" has 1000 AED
    When two concurrent transfers from "wallet_001" to "wallet_002" of 1000 AED with same idempotency key "idem-concurrent-001"
    Then exactly one transfer record should exist
    And wallet "wallet_001" balance should be 2000 AED via API
    And wallet "wallet_002" balance should be 2000 AED via API
