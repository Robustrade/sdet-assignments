package com.api.tests;

import static org.hamcrest.Matchers.equalTo;

import org.testng.Assert;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

import com.api.constant.ErrorCode;
import com.api.request.model.TransferPayload;
import com.api.utils.DataGeneratorUtil;

import io.restassured.response.Response;

/**
 * D) Idempotency / duplicate submission. Each test checks the response is stable across
 * duplicates and the DB shows exactly one execution.
 */
public class IdempotencyReliabilityTest extends BaseAPITest {

	private String sourceWalletId;
	private String destinationWalletId;

	@BeforeMethod(description = "Seeding source and destination wallets")
	public void seedWallets() {
		sourceWalletId = DataGeneratorUtil.getWalletId();
		destinationWalletId = DataGeneratorUtil.getWalletId();
	}

	@Test(description = "Verifying same key + same payload replays the original result without double debit", groups = {
			"api", "reliability", "regression" })
	public void sameKeySamePayloadReplaysOriginalResultTest() {
		walletDao.seedWallet(sourceWalletId, "AED", 10_000);
		walletDao.seedWallet(destinationWalletId, "AED", 0);
		TransferPayload payload = new TransferPayload(sourceWalletId, destinationWalletId, 2_500);
		String idempotencyKey = DataGeneratorUtil.getIdempotencyKey();

		String firstTransferId = transferService.createTransfer(payload, idempotencyKey).then()
				.statusCode(201).extract().path("transfer_id");

		Response replay = transferService.replayTransfer(payload, idempotencyKey);
		replay.then()
				.statusCode(201)
				.header("Idempotency-Replayed", equalTo("true"))
				.body("transfer_id", equalTo(firstTransferId));

		Assert.assertEquals(transferDao.countAllTransfers(), 1, "duplicate must not create a second transfer row");
		Assert.assertEquals(idempotencyKeyDao.countRowsForKey(idempotencyKey), 1);
		Assert.assertEquals(idempotencyKeyDao.getState(idempotencyKey), "COMPLETED",
				"idempotency reservation must be sealed after processing");
		Assert.assertEquals(idempotencyKeyDao.getTransferId(idempotencyKey), firstTransferId,
				"idempotency record must point at the one real transfer");
		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 7_500, "source must be debited exactly once");
		Assert.assertEquals(walletDao.getBalance(destinationWalletId), 2_500,
				"destination must be credited exactly once");
	}

	@Test(description = "Verifying the same key resubmitted three times processes exactly once (response-loss retry model)", groups = {
			"api", "reliability", "regression" })
	public void sameKeyResubmittedThreeTimesProcessesOnceTest() {
		walletDao.seedWallet(sourceWalletId, "AED", 10_000);
		walletDao.seedWallet(destinationWalletId, "AED", 0);
		TransferPayload payload = new TransferPayload(sourceWalletId, destinationWalletId, 1_000);
		String idempotencyKey = DataGeneratorUtil.getIdempotencyKey();

		// models a client that resends after each perceived response loss
		for (int attempt = 0; attempt < 3; attempt++) {
			transferService.createTransfer(payload, idempotencyKey).then().statusCode(201);
		}

		Assert.assertEquals(transferDao.countAllTransfers(), 1);
		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 9_000);
		Assert.assertEquals(walletDao.getBalance(destinationWalletId), 1_000);
	}

	@Test(description = "Verifying same key + different payload is rejected with 409 without processing", groups = {
			"api", "reliability", "regression" })
	public void sameKeyDifferentPayloadRejectedTest() {
		walletDao.seedWallet(sourceWalletId, "AED", 10_000);
		walletDao.seedWallet(destinationWalletId, "AED", 0);
		String idempotencyKey = DataGeneratorUtil.getIdempotencyKey();

		transferService.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 2_500),
				idempotencyKey).then().statusCode(201);

		// same key, different amount -- a client bug or key reuse, not a legitimate retry
		transferService.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 9_000),
				idempotencyKey).then()
				.statusCode(409)
				.body("error_code", equalTo(ErrorCode.IDEMPOTENCY_KEY_CONFLICT.getValue()));

		Assert.assertEquals(transferDao.countAllTransfers(), 1, "conflicting request must not be processed");
		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 7_500);
	}

	@Test(description = "Verifying a key reused after an insufficient-balance failure replays the original failure", groups = {
			"api", "reliability", "regression" })
	public void sameKeyReusedAfterFailureReplaysFailureTest() {
		walletDao.seedWallet(sourceWalletId, "AED", 500);
		walletDao.seedWallet(destinationWalletId, "AED", 0);
		TransferPayload payload = new TransferPayload(sourceWalletId, destinationWalletId, 5_000);
		String idempotencyKey = DataGeneratorUtil.getIdempotencyKey();

		transferService.createTransfer(payload, idempotencyKey).then().statusCode(422);
		transferService.replayTransfer(payload, idempotencyKey).then()
				.statusCode(422)
				.header("Idempotency-Replayed", equalTo("true"));

		Assert.assertEquals(transferDao.countAllTransfers(), 1);
		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 500, "no balance mutation on either attempt");
	}
}
