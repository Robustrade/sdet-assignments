package com.api.tests;

import static org.hamcrest.Matchers.equalTo;

import java.util.List;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.api.constant.EventType;
import com.api.constant.FailureReason;
import com.api.constant.TransferStatus;
import com.api.request.model.TransferPayload;
import com.api.utils.DataGeneratorUtil;

/**
 * C) Insufficient balance. A business rejection, not a validation error: persisted as a FAILED
 * transfer row, balances untouched, no outbox event.
 */
public class InsufficientBalanceTest extends BaseAPITest {

	@Test(description = "Verifying transfer exceeding the balance is rejected with balances unchanged", groups = {
			"api", "regression" })
	public void transferExceedingBalanceRejectedTest() {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		String destinationWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 1_000);
		walletDao.seedWallet(destinationWalletId, "AED", 0);

		transferService.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 5_000),
				DataGeneratorUtil.getIdempotencyKey()).then()
				.statusCode(422)
				.body("status", equalTo(TransferStatus.FAILED.getValue()))
				.body("failure_reason", equalTo(FailureReason.INSUFFICIENT_FUNDS.getValue()));

		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 1_000, "source balance must be unchanged");
		Assert.assertEquals(walletDao.getBalance(destinationWalletId), 0, "destination balance must be unchanged");
	}

	@Test(description = "Verifying a rejected transfer is persisted as a FAILED record with a coherent audit trail", groups = {
			"api", "regression" })
	public void rejectedTransferPersistedAsFailedRecordTest() {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		String destinationWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 100);
		walletDao.seedWallet(destinationWalletId, "AED", 0);

		String transferId = transferService
				.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 9_999),
						DataGeneratorUtil.getIdempotencyKey())
				.then().statusCode(422).extract().path("transfer_id");

		Assert.assertEquals(transferDao.countTransfersBetween(sourceWalletId, destinationWalletId), 1);
		Assert.assertEquals(transferEventDao.getEventTypes(transferId),
				List.of(EventType.TRANSFER_REQUESTED.getValue(), EventType.TRANSFER_FAILED.getValue()),
				"audit trail should show REQUESTED then FAILED");
	}

	@Test(description = "Verifying a rejected transfer does not emit an outbox event", groups = { "api",
			"regression" })
	public void rejectedTransferEmitsNoOutboxEventTest() {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		String destinationWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 100);
		walletDao.seedWallet(destinationWalletId, "AED", 0);

		String transferId = transferService
				.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 9_999),
						DataGeneratorUtil.getIdempotencyKey())
				.then().statusCode(422).extract().path("transfer_id");

		Assert.assertEquals(outboxEventDao.countEventsForTransfer(transferId), 0,
				"failed transfers must never publish an event");
	}

	@Test(description = "Verifying transfer of exactly the available balance succeeds (boundary is inclusive)", groups = {
			"api", "regression" })
	public void exactBalanceTransferSucceedsTest() {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		String destinationWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 2_500);
		walletDao.seedWallet(destinationWalletId, "AED", 0);

		transferService.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 2_500),
				DataGeneratorUtil.getIdempotencyKey()).then().statusCode(201);

		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 0);
	}
}
