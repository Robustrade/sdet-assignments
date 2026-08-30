package tests;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.Test;

import service.TransferService;
import utils.DatabaseUtils;

public class TransferTest extends BaseDatabaseTest {

	@Test
	public void testWalletTransfer() throws Exception {

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), "transfer-001");

		BigDecimal wallet1Balance = DatabaseUtils.getWalletBalance(1001);
		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("900.00"), wallet1Balance);
		assertEquals(new BigDecimal("600.00"), wallet2Balance);

		System.out.println("Wallet balances verified successfully!");
	}

	@Test
	public void testDuplicateTransfer() throws Exception {

		String idempotencyKey = "duplicate-transfer-001";

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		BigDecimal wallet1Balance = DatabaseUtils.getWalletBalance(1001);
		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("900.00"), wallet1Balance);
		assertEquals(new BigDecimal("600.00"), wallet2Balance);

		System.out.println("Duplicate transfer handled successfully!");
	}

	@Test
	public void testInsufficientBalance() throws Exception {

		String idempotencyKey = "insufficient-balance-001";

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("1500.00"), idempotencyKey);

			fail("Transfer should fail due to insufficient balance");

		} catch (SQLException e) {

			assertEquals("Insufficient balance in wallet: 1001", e.getMessage());

			System.out.println("Insufficient balance handled successfully!");
		}

		BigDecimal wallet1Balance = DatabaseUtils.getWalletBalance(1001);
		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("1000.00"), wallet1Balance);
		assertEquals(new BigDecimal("500.00"), wallet2Balance);

		System.out.println("Wallet balances remained unchanged!");
	}

	@Test
	public void testInvalidSourceWallet() throws Exception {

		String idempotencyKey = "invalid-wallet-001";

		try {

			TransferService.transfer(999, 1002, new BigDecimal("100.00"), idempotencyKey);

			fail("Transfer should fail because source wallet does not exist");

		} catch (SQLException e) {

			assertEquals("Source wallet not found: 999", e.getMessage());

			System.out.println("Invalid source wallet handled successfully!");
		}

		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("500.00"), wallet2Balance);

		System.out.println("Destination wallet balance remained unchanged!");
	}

	@Test
	public void testInvalidDestinationWallet() throws Exception {

		String idempotencyKey = "invalid-destination-001";

		try {

			TransferService.transfer(1001, 999, new BigDecimal("100.00"), idempotencyKey);

			fail("Transfer should fail because destination wallet does not exist");

		} catch (SQLException e) {

			System.out.println("Invalid destination wallet handled successfully!");
		}

		BigDecimal wallet1Balance = DatabaseUtils.getWalletBalance(1001);
		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("1000.00"), wallet1Balance);
		assertEquals(new BigDecimal("500.00"), wallet2Balance);

		System.out.println("Wallet balances remained unchanged!");
	}

	@Test
	public void testTransferPersistence() throws Exception {

		String idempotencyKey = "persistence-test-001";

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		String status = DatabaseUtils.getTransferStatus(idempotencyKey);

		assertEquals("completed", status);

		System.out.println("Transfer persistence verified successfully!");
	}

	@Test
	public void testConcurrentTransfers() throws Exception {

		ExecutorService executor = Executors.newFixedThreadPool(2);

		try {

			Future<?> transfer1 = executor.submit(() -> {

				try {

					TransferService.transfer(1001, 1002, new BigDecimal("100.00"), "concurrent-transfer-001");

				} catch (Exception e) {
					throw new RuntimeException(e);
				}
			});

			Future<?> transfer2 = executor.submit(() -> {

				try {

					TransferService.transfer(1001, 1002, new BigDecimal("100.00"), "concurrent-transfer-002");

				} catch (Exception e) {
					throw new RuntimeException(e);
				}
			});

			transfer1.get();
			transfer2.get();

		} finally {

			executor.shutdown();
		}

		BigDecimal wallet1Balance = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("800.00"), wallet1Balance);
		assertEquals(new BigDecimal("700.00"), wallet2Balance);

		System.out.println("Concurrent transfers handled successfully!");
		System.out.println("Final wallet 1 balance = " + wallet1Balance);
		System.out.println("Final wallet 2 balance = " + wallet2Balance);
	}

	@Test
	public void testTransferRecordDetails() throws Exception {

		String idempotencyKey = "transfer-details-001";

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		Object[] transfer = DatabaseUtils.getTransferDetails(idempotencyKey);

		assertEquals(idempotencyKey, transfer[0]);
		assertEquals(1001L, transfer[1]);
		assertEquals(1002L, transfer[2]);
		assertEquals(new BigDecimal("100.00"), transfer[3]);
		assertEquals("completed", transfer[4]);

		System.out.println("Complete transfer record verified successfully!");
	}

	@Test
	public void testInvalidTransferAmount() throws Exception {

		String idempotencyKey = "invalid-amount-001";

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("-100.00"), idempotencyKey);

			fail("Transfer should fail because amount is invalid");

		} catch (SQLException e) {

			assertEquals("Transfer amount must be greater than zero", e.getMessage());

			System.out.println("Invalid transfer amount handled successfully!");
		}

		BigDecimal wallet1Balance = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("1000.00"), wallet1Balance);
		assertEquals(new BigDecimal("500.00"), wallet2Balance);
	}

	@Test
	public void testZeroTransferAmount() throws Exception {

		String idempotencyKey = "zero-amount-001";

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("0.00"), idempotencyKey);

			fail("Transfer should fail because amount is zero");

		} catch (SQLException e) {

			assertEquals("Transfer amount must be greater than zero", e.getMessage());

			System.out.println("Zero transfer amount handled successfully!");
		}

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));
	}

	@Test
	public void testSameSourceAndDestinationWallet() throws Exception {

		String idempotencyKey = "same-wallet-001";

		try {

			TransferService.transfer(1001, 1001, new BigDecimal("100.00"), idempotencyKey);

			fail("Transfer should fail when source and destination wallets are the same");

		} catch (SQLException e) {

			assertEquals("Source and destination wallets cannot be the same", e.getMessage());

			System.out.println("Same source and destination wallet handled successfully!");
		}

		assertEquals(new BigDecimal("1000.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("500.00"), DatabaseUtils.getWalletBalance(1002));
	}

	@Test
	public void testConcurrentDuplicateTransfers() throws Exception {

		ExecutorService executor = Executors.newFixedThreadPool(2);

		String idempotencyKey = "concurrent-duplicate-001";

		try {

			Future<?> transfer1 = executor.submit(() -> {

				try {

					TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

				} catch (Exception e) {
					throw new RuntimeException(e);
				}
			});

			Future<?> transfer2 = executor.submit(() -> {

				try {

					TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

				} catch (Exception e) {
					throw new RuntimeException(e);
				}
			});

			transfer1.get();
			transfer2.get();

		} finally {

			executor.shutdown();
		}

		BigDecimal wallet1Balance = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Balance = DatabaseUtils.getWalletBalance(1002);

		assertEquals(new BigDecimal("900.00"), wallet1Balance);
		assertEquals(new BigDecimal("600.00"), wallet2Balance);

		System.out.println("Concurrent duplicate transfers handled successfully!");

		System.out.println("Final wallet 1 balance = " + wallet1Balance);

		System.out.println("Final wallet 2 balance = " + wallet2Balance);
	}

	@Test
	public void testFailedTransferIsNotPersisted() throws Exception {

		String idempotencyKey = "rollback-001";

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("1500.00"), idempotencyKey);

			fail("Transfer should fail because of insufficient balance");

		} catch (SQLException e) {

			System.out.println("Insufficient balance handled successfully!");
		}

		int transferCount = DatabaseUtils.getTransferCount(idempotencyKey);

		assertEquals(0, transferCount);

		System.out.println("Failed transfer was not persisted!");
	}

	@Test
	public void testDuplicateTransferCreatesOnlyOneRecord() throws Exception {

		String idempotencyKey = "duplicate-persistence-001";

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		int transferCount = DatabaseUtils.getTransferCount(idempotencyKey);

		assertEquals(1, transferCount, "Exactly one transfer record should exist");

		assertEquals(new BigDecimal("900.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("600.00"), DatabaseUtils.getWalletBalance(1002));

		System.out.println("Duplicate transfer created only one record successfully!");
	}

	@Test
	public void testRollbackWhenTransferPersistenceFails() throws Exception {

		String idempotencyKey = "12345678901234567890123456789012345678901234567890"
				+ "123456789012345678901234567890123456789012345678901";

		BigDecimal wallet1Before = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Before = DatabaseUtils.getWalletBalance(1002);

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

			fail("Transfer should fail because idempotency key is too long");

		} catch (SQLException e) {

			System.out.println("Transfer persistence failure handled successfully!");
		}

		BigDecimal wallet1After = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2After = DatabaseUtils.getWalletBalance(1002);

		assertEquals(wallet1Before, wallet1After);
		assertEquals(wallet2Before, wallet2After);

		int transferCount = DatabaseUtils.getTransferCount(idempotencyKey);

		assertEquals(0, transferCount);

		System.out.println("Wallet balances remained unchanged after rollback!");

		System.out.println("Failed transfer was not persisted!");
	}

	@Test
	public void testWalletCannotHaveNegativeBalance() throws Exception {

		String idempotencyKey = "negative-balance-001";

		BigDecimal wallet1Before = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Before = DatabaseUtils.getWalletBalance(1002);

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("1000.01"), idempotencyKey);

			fail("Transfer should fail because it would create a negative balance");

		} catch (SQLException e) {

			System.out.println("Negative balance prevented successfully!");
		}

		BigDecimal wallet1After = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2After = DatabaseUtils.getWalletBalance(1002);

		assertEquals(wallet1Before, wallet1After);
		assertEquals(wallet2Before, wallet2After);

		int transferCount = DatabaseUtils.getTransferCount(idempotencyKey);

		assertEquals(0, transferCount);

		System.out.println("Negative balance transfer was not persisted!");
	}

	@Test
	public void testNullIdempotencyKey() throws Exception {

		BigDecimal wallet1Before = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Before = DatabaseUtils.getWalletBalance(1002);

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("100.00"), null);

			fail("Transfer should fail when idempotency key is null");

		} catch (SQLException e) {

			System.out.println("Null idempotency key handled successfully!");
		}

		assertEquals(wallet1Before, DatabaseUtils.getWalletBalance(1001));

		assertEquals(wallet2Before, DatabaseUtils.getWalletBalance(1002));
	}

	@Test
	public void testBlankIdempotencyKey() throws Exception {

		BigDecimal wallet1Before = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Before = DatabaseUtils.getWalletBalance(1002);

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("100.00"), "   ");

			fail("Transfer should fail when idempotency key is blank");

		} catch (SQLException e) {

			System.out.println("Blank idempotency key handled successfully!");
		}

		assertEquals(wallet1Before, DatabaseUtils.getWalletBalance(1001));

		assertEquals(wallet2Before, DatabaseUtils.getWalletBalance(1002));
	}

	@Test
	public void testTransferWithDecimalAmount() throws Exception {

		String idempotencyKey = "decimal-amount-001";

		TransferService.transfer(1001, 1002, new BigDecimal("100.25"), idempotencyKey);

		assertEquals(new BigDecimal("899.75"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("600.25"), DatabaseUtils.getWalletBalance(1002));

		System.out.println("Decimal transfer amount handled successfully!");
	}

	@Test
	public void testTransferExactAvailableBalance() throws Exception {

		String idempotencyKey = "exact-balance-001";

		TransferService.transfer(1001, 1002, new BigDecimal("1000.00"), idempotencyKey);

		assertEquals(new BigDecimal("0.00"), DatabaseUtils.getWalletBalance(1001));

		assertEquals(new BigDecimal("1500.00"), DatabaseUtils.getWalletBalance(1002));

		System.out.println("Exact available balance transfer handled successfully!");
	}

	@Test
	public void testTransferAmountWithMoreThanTwoDecimals() throws Exception {

		String idempotencyKey = "precision-001";

		BigDecimal wallet1Before = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Before = DatabaseUtils.getWalletBalance(1002);

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("100.001"), idempotencyKey);

			fail("Transfer should fail when amount has more than 2 decimal places");

		} catch (SQLException e) {

			System.out.println("Invalid decimal precision handled successfully!");
		}

		assertEquals(wallet1Before, DatabaseUtils.getWalletBalance(1001));

		assertEquals(wallet2Before, DatabaseUtils.getWalletBalance(1002));

		int transferCount = DatabaseUtils.getTransferCount(idempotencyKey);

		assertEquals(0, transferCount);

		System.out.println("Invalid precision transfer was not persisted!");
	}

	@Test
	public void testNegativeTransferAmount() throws Exception {

		String idempotencyKey = "negative-amount-001";

		BigDecimal wallet1Before = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Before = DatabaseUtils.getWalletBalance(1002);

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("-100.00"), idempotencyKey);

			fail("Transfer should fail when amount is negative");

		} catch (SQLException e) {

			System.out.println("Negative transfer amount handled successfully!");
		}

		assertEquals(wallet1Before, DatabaseUtils.getWalletBalance(1001));

		assertEquals(wallet2Before, DatabaseUtils.getWalletBalance(1002));

		int transferCount = DatabaseUtils.getTransferCount(idempotencyKey);

		assertEquals(0, transferCount);

		System.out.println("Negative amount transfer was not persisted!");
	}

	@Test
	public void testEmptyIdempotencyKey() throws Exception {

		BigDecimal wallet1Before = DatabaseUtils.getWalletBalance(1001);

		BigDecimal wallet2Before = DatabaseUtils.getWalletBalance(1002);

		try {

			TransferService.transfer(1001, 1002, new BigDecimal("100.00"), "");

			fail("Transfer should fail when idempotency key is empty");

		} catch (SQLException e) {

			System.out.println("Empty idempotency key handled successfully!");
		}

		assertEquals(wallet1Before, DatabaseUtils.getWalletBalance(1001));

		assertEquals(wallet2Before, DatabaseUtils.getWalletBalance(1002));
	}

	@Test
	public void testSuccessfulTransferCreatesOneRecord() throws Exception {

		String idempotencyKey = "record-count-001";

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		int transferCount = DatabaseUtils.getTransferCount(idempotencyKey);

		assertEquals(1, transferCount, "Exactly one transfer record should be created");

		System.out.println("Successful transfer created exactly one record!");
	}

	@Test
	public void testSuccessfulTransferStatus() throws Exception {

		String idempotencyKey = "status-001";

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		String status = DatabaseUtils.getTransferStatus(idempotencyKey);

		assertEquals("completed", status, "Transfer status should be completed");

		System.out.println("Transfer status verified successfully!");
	}

	@Test
	public void testCompleteTransferDetails() throws Exception {

		String idempotencyKey = "details-001";

		TransferService.transfer(1001, 1002, new BigDecimal("100.00"), idempotencyKey);

		Object[] transferDetails = DatabaseUtils.getTransferDetails(idempotencyKey);

		assertEquals(idempotencyKey, transferDetails[0]);

		assertEquals(1001L, transferDetails[1]);

		assertEquals(1002L, transferDetails[2]);

		assertEquals(new BigDecimal("100.00"), transferDetails[3]);

		assertEquals("completed", transferDetails[4]);

		System.out.println("Complete transfer details verified successfully!");
	}
}