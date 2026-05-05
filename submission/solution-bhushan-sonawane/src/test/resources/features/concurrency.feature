Feature: Concurrency and race condition handling

  Scenario: Two concurrent transfers competing for limited balance
    Given wallet "wallet_001" has 3000 AED
    And wallet "wallet_002" has 1000 AED
    When two concurrent transfers from "wallet_001" to "wallet_002" of 2000 AED are executed
    Then exactly one transfer record should exist
    And wallet "wallet_001" balance should not be negative