package com.api.tests;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

import org.testng.Assert;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

import com.api.constant.TransferStatus;
import com.api.request.model.TransferPayload;
import com.api.utils.DataGeneratorUtil;

import io.restassured.response.Response;

/**
 * A) Happy path: exactly-once debit/credit, correct status, persisted state matches the API
 * result.
 */
public class HappyPathTransferTest extends BaseAPITest {

	private String sourceWalletId;
	private String destinationWalletId;

	@BeforeMethod(description = "Seeding source and destination wallets with known balances")
	public void seedWallets() {
		sourceWalletId = DataGeneratorUtil.getWalletId();
		destinationWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 10_000);
		walletDao.seedWallet(destinationWalletId, "AED", 0);
	}

	@Test(description = "Verifying a successful transfer debits source and credits destination exactly once", groups = {
			"api", "smoke", "regression" })
	public void successfulTransferDebitsAndCreditsExactlyOnceTest() {
		TransferPayload payload = new TransferPayload(sourceWalletId, destinationWalletId, 2_500);

		Response response = transferService.createTransfer(payload, DataGeneratorUtil.getIdempotencyKey());

		response.then()
				.statusCode(201)
				.body("status", equalTo(TransferStatus.COMPLETED.getValue()))
				.body("transfer_id", notNullValue())
				.body("source_wallet_id", equalTo(sourceWalletId))
				.body("destination_wallet_id", equalTo(destinationWalletId))
				.body("amount", equalTo(2_500));

		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 7_500, "source wallet balance after debit");
		Assert.assertEquals(walletDao.getBalance(destinationWalletId), 2_500,
				"destination wallet balance after credit");
		Assert.assertEquals(transferDao.countTransfersBetween(sourceWalletId, destinationWalletId), 1,
				"exactly one transfer row should exist");
	}

	@Test(description = "Verifying total balance across both wallets is conserved by a transfer", groups = { "api",
			"regression" })
	public void transferConservesTotalBalanceTest() {
		long totalBefore = walletDao.getBalance(sourceWalletId) + walletDao.getBalance(destinationWalletId);

		transferService.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 3_000),
				DataGeneratorUtil.getIdempotencyKey()).then().statusCode(201);

		long totalAfter = walletDao.getBalance(sourceWalletId) + walletDao.getBalance(destinationWalletId);
		Assert.assertEquals(totalAfter, totalBefore, "money must be conserved across the wallet pair");
		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 10_000 - 3_000);
		Assert.assertEquals(walletDao.getBalance(destinationWalletId), 3_000);
	}

	@Test(description = "Verifying a completed transfer is readable via GET /transfers/{id} and matches the POST response", groups = {
			"api", "regression" })
	public void completedTransferReadableViaGetTest() {
		String transferId = transferService
				.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 1_000),
						DataGeneratorUtil.getIdempotencyKey())
				.then().statusCode(201).extract().path("transfer_id");

		transferService.getTransfer(transferId).then()
				.statusCode(200)
				.body("transfer_id", equalTo(transferId))
				.body("status", equalTo(TransferStatus.COMPLETED.getValue()))
				.body("amount", equalTo(1_000));
	}

	@Test(description = "Verifying wallet balances are readable via GET /wallets/{id} after a transfer", groups = {
			"api", "regression" })
	public void walletBalanceReadableViaGetWalletTest() {
		transferService.createTransfer(new TransferPayload(sourceWalletId, destinationWalletId, 4_000),
				DataGeneratorUtil.getIdempotencyKey()).then().statusCode(201);

		transferService.getWallet(sourceWalletId).then().statusCode(200).body("balance", equalTo(6_000));
		transferService.getWallet(destinationWalletId).then().statusCode(200).body("balance", equalTo(4_000));
	}
}
