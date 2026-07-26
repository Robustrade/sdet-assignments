package com.api.tests;

import static org.hamcrest.Matchers.equalTo;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.api.constant.ErrorCode;
import com.api.request.model.TransferPayload;
import com.api.utils.DataGeneratorUtil;

/**
 * B) Validation failures. Each test checks status + error_code and that no transfer row was
 * persisted.
 */
public class TransferValidationTest extends BaseAPITest {

	private String seedWallet(long balance) {
		String walletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(walletId, "AED", balance);
		return walletId;
	}

	private void assertRejectedWithNoPersistence(Object payload, int expectedStatus, ErrorCode expectedErrorCode) {
		int transfersBefore = transferDao.countAllTransfers();

		transferService.createTransfer(payload, DataGeneratorUtil.getIdempotencyKey()).then()
				.statusCode(expectedStatus)
				.body("error_code", equalTo(expectedErrorCode.getValue()));

		Assert.assertEquals(transferDao.countAllTransfers(), transfersBefore,
				"a rejected request must not persist a transfer row");
	}

	@Test(description = "Verifying transfer with missing source_wallet_id is rejected with 400", groups = { "api",
			"regression" })
	public void missingSourceWalletIdRejectedTest() {
		String destinationWalletId = seedWallet(0);
		TransferPayload payload = new TransferPayload(null, destinationWalletId, 1_000L, "AED",
				DataGeneratorUtil.getReference());

		assertRejectedWithNoPersistence(payload, 400, ErrorCode.VALIDATION_ERROR);
	}

	@Test(description = "Verifying transfer with missing destination_wallet_id is rejected with 400", groups = { "api",
			"regression" })
	public void missingDestinationWalletIdRejectedTest() {
		String sourceWalletId = seedWallet(10_000);
		TransferPayload payload = new TransferPayload(sourceWalletId, null, 1_000L, "AED",
				DataGeneratorUtil.getReference());

		assertRejectedWithNoPersistence(payload, 400, ErrorCode.VALIDATION_ERROR);
	}

	@Test(description = "Verifying transfer with zero amount is rejected with 400", groups = { "api", "regression" })
	public void zeroAmountRejectedTest() {
		assertRejectedWithNoPersistence(new TransferPayload(seedWallet(10_000), seedWallet(0), 0), 400,
				ErrorCode.VALIDATION_ERROR);
	}

	@Test(description = "Verifying transfer with negative amount is rejected with 400", groups = { "api",
			"regression" })
	public void negativeAmountRejectedTest() {
		assertRejectedWithNoPersistence(new TransferPayload(seedWallet(10_000), seedWallet(0), -500), 400,
				ErrorCode.VALIDATION_ERROR);
	}

	@Test(description = "Verifying transfer with non-numeric amount is rejected with 400", groups = { "api",
			"regression" })
	public void nonNumericAmountRejectedTest() {
		// raw map payload because the typed POJO cannot express a broken amount field
		Map<String, Object> payload = new LinkedHashMap<>();
		payload.put("source_wallet_id", seedWallet(10_000));
		payload.put("destination_wallet_id", seedWallet(0));
		payload.put("amount", "not-a-number");
		payload.put("currency", "AED");
		payload.put("reference", DataGeneratorUtil.getReference());

		assertRejectedWithNoPersistence(payload, 400, ErrorCode.MALFORMED_JSON);
	}

	@Test(description = "Verifying transfer where source and destination are the same wallet is rejected with 400", groups = {
			"api", "regression" })
	public void sourceEqualsDestinationRejectedTest() {
		String walletId = seedWallet(10_000);
		assertRejectedWithNoPersistence(new TransferPayload(walletId, walletId, 1_000), 400,
				ErrorCode.VALIDATION_ERROR);
	}

	@Test(description = "Verifying transfer with lowercase currency code is rejected with 400", groups = { "api",
			"regression" })
	public void invalidCurrencyFormatRejectedTest() {
		TransferPayload payload = new TransferPayload(seedWallet(10_000), seedWallet(0), 1_000L, "aed",
				DataGeneratorUtil.getReference());
		assertRejectedWithNoPersistence(payload, 400, ErrorCode.VALIDATION_ERROR);
	}

	@Test(description = "Verifying transfer whose currency does not match the wallet currency is rejected with 400", groups = {
			"api", "regression" })
	public void currencyMismatchRejectedTest() {
		// wallets are seeded as AED
		TransferPayload payload = new TransferPayload(seedWallet(10_000), seedWallet(0), 1_000L, "USD",
				DataGeneratorUtil.getReference());
		assertRejectedWithNoPersistence(payload, 400, ErrorCode.VALIDATION_ERROR);
	}

	@Test(description = "Verifying transfer without the Idempotency-Key header is rejected with 400", groups = { "api",
			"regression" })
	public void missingIdempotencyKeyHeaderRejectedTest() {
		int transfersBefore = transferDao.countAllTransfers();

		transferService.createTransfer(new TransferPayload(seedWallet(10_000), seedWallet(0), 1_000), null).then()
				.statusCode(400)
				.body("error_code", equalTo(ErrorCode.VALIDATION_ERROR.getValue()));

		Assert.assertEquals(transferDao.countAllTransfers(), transfersBefore);
	}

	@Test(description = "Verifying transfer from an unknown source wallet is rejected with 404", groups = { "api",
			"regression" })
	public void unknownSourceWalletRejectedTest() {
		assertRejectedWithNoPersistence(
				new TransferPayload(DataGeneratorUtil.getWalletId(), seedWallet(0), 1_000), 404,
				ErrorCode.WALLET_NOT_FOUND);
	}

	@Test(description = "Verifying transfer to an unknown destination wallet is rejected with 404", groups = { "api",
			"regression" })
	public void unknownDestinationWalletRejectedTest() {
		assertRejectedWithNoPersistence(
				new TransferPayload(seedWallet(10_000), DataGeneratorUtil.getWalletId(), 1_000), 404,
				ErrorCode.WALLET_NOT_FOUND);
	}

	@Test(description = "Verifying GET /transfers/{id} for an unknown transfer returns 404", groups = { "api",
			"regression" })
	public void getUnknownTransferReturns404Test() {
		transferService.getTransfer(UUID.randomUUID().toString()).then()
				.statusCode(404)
				.body("error_code", equalTo(ErrorCode.TRANSFER_NOT_FOUND.getValue()));
	}

	@Test(description = "Verifying GET /wallets/{id} for an unknown wallet returns 404", groups = { "api",
			"regression" })
	public void getUnknownWalletReturns404Test() {
		transferService.getWallet(DataGeneratorUtil.getWalletId()).then()
				.statusCode(404)
				.body("error_code", equalTo(ErrorCode.WALLET_NOT_FOUND.getValue()));
	}
}
