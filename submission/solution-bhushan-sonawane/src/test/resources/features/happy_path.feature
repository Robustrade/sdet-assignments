Feature: Happy path wallet transfer

  Scenario: Successful wallet-to-wallet transfer
    Given wallet "wallet_001" has 5000 AED
    And wallet "wallet_002" has 1000 AED
    When I create a transfer from "wallet_001" to "wallet_002" of 2500 AED with idempotency key "hp-001"
    Then the transfer status should be "SUCCESS"
    And exactly one transfer record should exist
    And wallet "wallet_001" balance should be 2500 AED via API
    And wallet "wallet_002" balance should be 3500 AED via API