# Test Cases Document - Wallet Transfer Service

## Overview
This document lists all automated test cases for the Wallet Transfer Service API automation framework. The tests cover API contract validation, business workflow verification, database persistence validation, and concurrency handling.

**Total Test Cases: 45**
- API Contract Tests: 23
- Workflow Tests: 8
- Database Verification Tests: 9
- Concurrency Tests: 5

---

## Test Cases

| TestId | TestSummary | Pre-requisites | Test Steps | Expected Results | Test Status |
|--------|-------------|----------------|------------|------------------|-------------|
| **TC_001** | Verify successful transfer between wallets with sufficient balance | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Generate idempotency key<br>2. Create transfer request: 1000 INR from wallet_001 to wallet_002<br>3. POST /transfers with idempotency key<br>4. Validate response | HTTP 201, status=COMPLETED, correct transferId, amount=1000, currency=INR, source=wallet_001, destination=wallet_002, reference=invoice_123 | ✅ PASS |
| **TC_002** | Verify 201 Created status returned on successful transfer | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Generate idempotency key<br>2. Create transfer request: 500 INR from wallet_001 to wallet_002<br>3. POST /transfers with idempotency key | HTTP 201 status code | ✅ PASS |
| **TC_003** | Verify transfer can be retrieved by ID | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Create transfer (250 INR wallet_001→wallet_002)<br>2. GET /transfers/{transferId}<br>3. Compare response with created transfer | HTTP 200, retrieved transfer matches created transfer in all fields | ✅ PASS |
| **TC_004** | Verify wallet can be retrieved by ID | Wallets seeded: wallet_001 (10000 INR) | 1. GET /wallets/wallet_001<br>2. Validate response | HTTP 200, walletId=wallet_001, balance=10000.00, currency=INR | ✅ PASS |
| **TC_005** | Verify multiple sequential transfers from same source wallet | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR), wallet_003 (2000 INR) | 1. Transfer 100 INR wallet_001→wallet_002 (key1)<br>2. Transfer 200 INR wallet_001→wallet_003 (key2)<br>3. Validate both responses | Both HTTP 201, status=COMPLETED, different transferIds | ✅ PASS |
| **TC_006** | Verify request rejected with missing source wallet ID | Wallet fixtures available | 1. Create request with empty sourceWalletId, valid destination, amount, currency, reference<br>2. POST /transfers with idempotency key | HTTP 400, error code=INVALID_REQUEST | ✅ PASS |
| **TC_007** | Verify request rejected with missing destination wallet ID | Wallet fixtures available | 1. Create request with valid sourceWalletId, empty destinationWalletId<br>2. POST /transfers with idempotency key | HTTP 400, error code=INVALID_REQUEST | ✅ PASS |
| **TC_008** | Verify request rejected with zero amount | Wallet fixtures available | 1. Create request with amount=0<br>2. POST /transfers with idempotency key | HTTP 400, error code=INVALID_AMOUNT | ✅ PASS |
| **TC_009** | Verify request rejected with negative amount | Wallet fixtures available | 1. Create request with amount=-100<br>2. POST /transfers with idempotency key | HTTP 400, error code=INVALID_AMOUNT | ✅ PASS |
| **TC_010** | Verify request rejected with missing currency | Wallet fixtures available | 1. Create request without currency field<br>2. POST /transfers with idempotency key | HTTP 400 | ✅ PASS |
| **TC_011** | Verify request rejected with missing reference | Wallet fixtures available | 1. Create request without reference field<br>2. POST /transfers with idempotency key | HTTP 400 | ✅ PASS |
| **TC_012** | Verify request rejected with same source and destination wallet | Wallet fixtures available | 1. Create request with sourceWalletId=destinationWalletId=wallet_001<br>2. POST /transfers with idempotency key | HTTP 400, error code=SAME_WALLET | ✅ PASS |
| **TC_013** | Verify request rejected without idempotency key | Wallet fixtures available | 1. Create valid transfer request<br>2. POST /transfers WITHOUT Idempotency-Key header | HTTP 400, error code=INVALID_REQUEST | ✅ PASS |
| **TC_014** | Verify invalid transfer ID format rejected on GET | Wallet fixtures available | 1. GET /transfers/00000000-0000-0000-0000-000000000000 | HTTP 404 | ✅ PASS |
| **TC_015** | Verify 404 returned for non-existent wallet | Wallet fixtures available | 1. GET /wallets/non_existent_wallet | HTTP 404, error code=WALLET_NOT_FOUND | ✅ PASS |
| **TC_016** | Verify transfer rejected with insufficient balance | Wallets seeded: wallet_003 (2000 INR), wallet_001 (10000 INR) | 1. Create request: 5000 INR from wallet_003 to wallet_001<br>2. POST /transfers with idempotency key | HTTP 409, error code=INSUFFICIENT_BALANCE | ✅ PASS |
| **TC_017** | Verify transfer rejected when source wallet has zero balance | Wallet fixtures available | 1. Create wallet_empty with 0 INR balance<br>2. Create request: 1 INR from wallet_empty to wallet_001<br>3. POST /transfers with idempotency key | HTTP 409, error code=INSUFFICIENT_BALANCE | ✅ PASS |
| **TC_018** | Verify transfer rejected to non-existent destination wallet | Wallets seeded: wallet_001 (10000 INR) | 1. Create request: 100 INR from wallet_001 to wallet_nonexistent<br>2. POST /transfers with idempotency key | HTTP 404, error code=WALLET_NOT_FOUND | ✅ PASS |
| **TC_019** | Verify transfer rejected from non-existent source wallet | Wallets seeded: wallet_001 (10000 INR) | 1. Create request: 100 INR from wallet_nonexistent to wallet_001<br>2. POST /transfers with idempotency key | HTTP 404, error code=WALLET_NOT_FOUND | ✅ PASS |
| **TC_020** | Verify transfer rejected with mismatched currency | Wallets seeded: wallet_001 (INR), wallet_002 (INR) | 1. Create request: 100 INR from wallet_001 to wallet_002 with currency=USD<br>2. POST /transfers with idempotency key | HTTP 400, error code=INVALID_CURRENCY | ✅ PASS |
| **TC_021** | Verify 404 returned for non-existent transfer | Wallet fixtures available | 1. GET /transfers/{random-UUID} | HTTP 404, error code=TRANSFER_NOT_FOUND | ✅ PASS |
| **TC_022** | Verify no balance modification on insufficient balance rejection | Wallets seeded: wallet_003 (2000 INR), wallet_001 (10000 INR) | 1. Record initial balances<br>2. Attempt transfer 5000 INR from wallet_003 to wallet_001<br>3. Check balances after rejection | Both wallet balances unchanged | ✅ PASS |
| **TC_023** | Verify no balance modification on invalid wallet rejection | Wallets seeded: wallet_001 (10000 INR) | 1. Record initial source balance<br>2. Attempt transfer to wallet_nonexistent<br>3. Check source balance after rejection | Source wallet balance unchanged | ✅ PASS |
| **TC_024** | Verify end-to-end transfer with multi-layer verification | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Record initial balances and total<br>2. Transfer 1000 INR wallet_001→wallet_002<br>3. Verify: API response, wallet balances (9000/6000), transfer persisted (COMPLETED), 3 audit records (TRANSFER_CREATED, DEBIT, CREDIT), 1 outbox event (TRANSFER_COMPLETED), idempotency record stored, no duplicates, total conserved (15000) | All assertions pass across all layers | ✅ PASS |
| **TC_025** | Verify duplicate request with same idempotency key returns original result | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 500 INR wallet_001→wallet_002 (key1)<br>2. Repeat same request with same key<br>3. Compare responses<br>4. Verify balances and no duplicates | Both responses: same transferId, COMPLETED; balances: 9500/5500; exactly 1 transfer record, 3 audits, 1 outbox | ✅ PASS |
| **TC_026** | Verify duplicate request with different payload rejected (same idempotency key) | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 500 INR wallet_001→wallet_002 (key1, ref_1)<br>2. Attempt transfer 1000 INR wallet_001→wallet_002 (key1, ref_2)<br>3. Verify conflict response | HTTP 409, error code=IDEMPOTENCY_KEY_CONFLICT | ✅ PASS |
| **TC_027** | Verify retry after timeout returns original result (idempotent retry) | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 250 INR wallet_001→wallet_002 (key1)<br>2. Retry same request with same key<br>3. Compare responses<br>4. Verify balances and no duplicates | Both responses: same transferId, COMPLETED; balances: 9750/5250; no duplicate side effects | ✅ PASS |
| **TC_028** | Verify exactly-once semantics under concurrent load (same idempotency key) | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Launch 10 concurrent threads with same request (100 INR wallet_001→wallet_002, same key)<br>2. Wait for completion<br>3. Verify transfer count and balances | Exactly 1 COMPLETED transfer; balances: 9900/5100 | ✅ PASS |
| **TC_029** | Verify concurrent transfers from same source wallet handle race conditions | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR), wallet_003 (2000 INR) | 1. Launch 2 concurrent transfers: 3000 INR wallet_001→wallet_002 (key1) and 4000 INR wallet_001→wallet_003 (key2)<br>2. Wait for completion<br>3. Verify total conserved and at least one succeeds | Total balance conserved (17000 INR); at least 1 transfer succeeds | ✅ PASS |
| **TC_030** | Verify idempotency record contains correct response | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 750 INR wallet_001→wallet_002<br>2. Retrieve idempotency record by key<br>3. Validate record contents | Record contains: correct key, non-null response, matching transferId, COMPLETED status, amount=750 | ✅ PASS |
| **TC_031** | Verify no balance modification on validation failure | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Record initial balances<br>2. Submit invalid request (amount=0) wallet_001→wallet_002<br>3. Check balances | Both wallet balances unchanged | ✅ PASS |
| **TC_032** | Verify wallet persisted with correct balance after transfer | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 1000 INR wallet_001→wallet_002<br>2. Query wallet repository directly<br>3. Validate source=9000, dest=6000, currency=INR, IDs correct | Source wallet balance=9000, dest wallet balance=6000, both currency=INR, correct walletIds | ✅ PASS |
| **TC_033** | Verify transfer record persisted with all fields | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 500 INR wallet_001→wallet_002<br>2. Query transfer repository by ID<br>3. Validate all fields | Transfer record matches: transferId, source, destination, amount=500, currency=INR, reference, status=COMPLETED, timestamps present | ✅ PASS |
| **TC_034** | Verify failed transfer record persisted on insufficient balance | Wallets seeded: wallet_003 (2000 INR), wallet_001 (10000 INR) | 1. Attempt transfer 5000 INR wallet_003→wallet_001<br>2. Query all transfers, filter FAILED<br>3. Validate failed transfer | Exactly 1 FAILED transfer: source=wallet_003, dest=wallet_001, amount=5000, status=FAILED | ✅ PASS |
| **TC_035** | Verify audit records created for transfer lifecycle (3 audits) | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 750 INR wallet_001→wallet_002<br>2. Query audit repository by transferId<br>3. Validate audit count and types | 3 audits: TRANSFER_CREATED, DEBIT, CREDIT; all reference transferId, have timestamps | ✅ PASS |
| **TC_036** | Verify audit record created for failed transfer | Wallets seeded: wallet_003 (2000 INR), wallet_001 (10000 INR) | 1. Attempt transfer 5000 INR wallet_003→wallet_001<br>2. Find failed transfer<br>3. Query audits by failed transferId | 1 audit: action=TRANSFER_FAILED, details contain "Insufficient balance" | ✅ PASS |
| **TC_037** | Verify outbox event created for completed transfer | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 250 INR wallet_001→wallet_002<br>2. Query outbox repository<br>3. Filter by aggregateId=transferId, eventType=TRANSFER_COMPLETED, published=false | 1 outbox event: correct aggregateId, eventType=TRANSFER_COMPLETED, non-null payload, published=false, has createdAt | ✅ PASS |
| **TC_038** | Verify no outbox event created for failed transfer | Wallets seeded: wallet_003 (2000 INR), wallet_001 (10000 INR) | 1. Attempt transfer 5000 INR wallet_003→wallet_001<br>2. Find failed transfer<br>3. Check outbox for TRANSFER_COMPLETED with failed transferId | No TRANSFER_COMPLETED outbox event exists for failed transfer | ✅ PASS |
| **TC_039** | Verify idempotency record stored correctly | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 100 INR wallet_001→wallet_002<br>2. Query idempotency repository by key<br>3. Validate record | Record exists: correct key, non-null requestHash, response with COMPLETED status, non-null transferId | ✅ PASS |
| **TC_040** | Verify no duplicate records created on duplicate request | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Transfer 300 INR wallet_001→wallet_002 (key1)<br>2. Repeat same request with same key<br>3. Count records across all repositories | 1 COMPLETED transfer, 3 audits, 1 outbox event, 1 idempotency record | ✅ PASS |
| **TC_041** | Verify concurrent duplicate requests with same idempotency key (exactly-once) | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Launch 20 concurrent threads with same request (100 INR wallet_001→wallet_002, same key)<br>2. Wait for all threads<br>3. Count successes, transfers, verify balances | All 20 threads HTTP 201; exactly 1 COMPLETED transfer; balances: 9900/5100 | ✅ PASS |
| **TC_042** | Verify concurrent transfers from same source wallet handle race conditions | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR), wallet_003 (2000 INR) | 1. Launch 3 concurrent transfers: 2000 INR wallet_001→wallet_002, 3000 INR wallet_001→wallet_003, 1000 INR wallet_001→wallet_002<br>2. Wait for completion<br>3. Verify total debited <= source balance, at least 1 succeeds | Total debited <= 10000; at least 1 transfer succeeds (1-3) | ✅ PASS |
| **TC_043** | Verify high contention on idempotency store (50 threads, same key) | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Launch 50 concurrent threads with same request (50 INR wallet_001→wallet_002, same key)<br>2. Wait for all threads<br>3. Count successes, transfers, verify balances | All 50 threads HTTP 201; exactly 1 COMPLETED transfer; balances: 9950/5050 | ✅ PASS |
| **TC_044** | Verify concurrent transfers to different destinations conserve total balance | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR), wallet_003 (2000 INR) | 1. Launch 4 concurrent transfers: 1000 INR wallet_001→wallet_002, 1500 INR wallet_001→wallet_003, 500 INR wallet_002→wallet_001, 800 INR wallet_003→wallet_001<br>2. Wait for completion<br>3. Verify total balance conserved, some succeed | Total balance conserved (17000 INR); at least some transfers succeed | ✅ PASS |
| **TC_045** | Verify exactly-once semantics under load (100 threads, same key) | Wallets seeded: wallet_001 (10000 INR), wallet_002 (5000 INR) | 1. Launch 100 concurrent threads (20 thread pool) with same request (1 INR wallet_001→wallet_002, same key)<br>2. Wait for all threads<br>3. Count successes, transfers, verify balances | All 100 threads HTTP 201; exactly 1 COMPLETED transfer; balances: 9999/5001 | ✅ PASS |

---

## Legend

| Status | Meaning |
|--------|---------|
| ✅ PASS | Test implemented and passing |
| ❌ FAIL | Test implemented but failing |
| ⏳ PENDING | Test not yet implemented |
| ⚠️ SKIPPED | Test intentionally skipped |

---

## Traceability Matrix

| Requirement ID | Requirement Description | Covered By Test Cases |
|----------------|------------------------|----------------------|
| FR-01 | Create transfer | API-HP-001, API-HP-002, WF-001, DB-001, DB-002 |
| FR-02 | Retrieve transfer | API-HP-003 |
| FR-03 | Retrieve wallet | API-HP-004 |
| FR-04 | Validate request | API-VAL-001 to API-VAL-010 |
| FR-05 | Reject insufficient balance | API-IB-001, API-IB-002, WF-008, DB-003, DB-005, DB-007 |
| FR-06 | Debit source wallet | WF-001, DB-001 |
| FR-07 | Credit destination wallet | WF-001, DB-001 |
| FR-08 | Persist transfer | DB-002, DB-003 |
| FR-09 | Persist audit record | WF-001, DB-004, DB-005 |
| FR-10 | Persist outbox event | WF-001, DB-006, DB-007 |
| FR-11 | Idempotency (same key) | WF-002, WF-004, WF-005, WF-007, DB-008, CONC-001, CONC-003, CONC-005 |
| FR-12 | Duplicate request handling | WF-002, WF-003, DB-009 |
| FR-13 | Retry after timeout | WF-004 |
| FR-14 | Concurrent transfers | WF-006, CONC-002, CONC-004 |
| FR-15 | Transaction integrity | WF-001, WF-005, CONC-001, CONC-003, CONC-005 |

---

## Notes

1. **Wallet Fixtures**: All tests use seeded wallets: wallet_001 (10000 INR), wallet_002 (5000 INR), wallet_003 (2000 INR)
2. **Idempotency Keys**: Each test generates unique idempotency keys using UUID.randomUUID()
3. **Currency**: All tests use INR currency unless testing currency mismatch
4. **Isolation**: Each test runs with fresh repository state (seeded in @BeforeEach)
5. **Concurrency Tests**: Use CountDownLatch for synchronized thread starts and ExecutorService for thread pooling
6. **Verification Layers**: Workflow and Database tests verify across API → Workflow → Repository → Audit → Outbox → Idempotency layers