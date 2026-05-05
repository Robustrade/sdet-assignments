Feature: Persistence and auditability

  Scenario: Successful transfer creates audit log and outbox event
    Given wallet "wallet_001" has 4000 AED
    And wallet "wallet_002" has 1000 AED
    When I create a transfer from "wallet_001" to "wallet_002" of 1000 AED with idempotency key "db-001"
    Then the transfer status should be "SUCCESS"
    And exactly one transfer record should exist
    And audit log entry should exist
    And outbox event should exist once