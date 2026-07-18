package com.api.tests;

import static org.hamcrest.Matchers.equalTo;

import java.util.List;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.api.constant.EventType;
import com.api.constant.TransferStatus;
import com.api.request.model.TransferPayload;
import com.api.utils.DataGeneratorUtil;
import com.database.model.OutboxEventDBModel;

import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;

/**
 * F) Persistence/auditability + G) component interaction. The outbox table stands in for a real
 * broker (see STRATEGY.md): written exactly once with the transfer, absent when nothing should
 * have been published.
 */
public class PersistenceAndAuditTest extends BaseAPITest {

	@Test(description = "Verifying a completed transfer persists a coherent audit trail across all tables", groups = {
			"api", "regression" })
	public void completedTransferCoherentAcrossAllTablesTest() {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		String destinationWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 10_000);
		walletDao.seedWallet(destinationWalletId, "AED", 0);

		Response response = transferService.createTransfer(
				new TransferPayload(sourceWalletId, destinationWalletId, 2_000),
				DataGeneratorUtil.getIdempotencyKey());
		response.then().statusCode(201);
		String transferId = response.jsonPath().getString("transfer_id");

		// 1. persisted transfer matches the API-visible result
		transferService.getTransfer(transferId).then()
				.statusCode(200)
				.body("status", equalTo(TransferStatus.COMPLETED.getValue()))
				.body("amount", equalTo(2_000));

		// 2. audit rows in lifecycle order
		Assert.assertEquals(transferEventDao.getEventTypes(transferId),
				List.of(EventType.TRANSFER_REQUESTED.getValue(), EventType.TRANSFER_COMPLETED.getValue()));

		// 3. exactly-once event emission in the outbox, with the CONTENT a downstream
		// consumer would actually receive -- not just that a row exists
		Assert.assertEquals(outboxEventDao.countEventsForTransfer(transferId), 1);
		OutboxEventDBModel outboxEvent = outboxEventDao.getEventForTransfer(transferId);
		Assert.assertEquals(outboxEvent.getAggregateType(), "TRANSFER");
		Assert.assertEquals(outboxEvent.getEventType(), EventType.TRANSFER_COMPLETED.getValue());
		Assert.assertFalse(outboxEvent.isPublished(), "relay has not run, so the event must be unpublished");
		JsonPath payloadJson = new JsonPath(outboxEvent.getPayload());
		Assert.assertEquals(payloadJson.getString("transfer_id"), transferId);
		Assert.assertEquals(payloadJson.getString("source_wallet_id"), sourceWalletId);
		Assert.assertEquals(payloadJson.getString("destination_wallet_id"), destinationWalletId);
		Assert.assertEquals(payloadJson.getLong("amount"), 2_000L);

		// 4. balances reflect the exact net movement
		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 8_000);
		Assert.assertEquals(walletDao.getBalance(destinationWalletId), 2_000);
	}

	@Test(description = "Verifying a duplicate submission emits no additional outbox event or audit rows", groups = {
			"api", "regression" })
	public void duplicateSubmissionEmitsNothingExtraTest() {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		String destinationWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 10_000);
		walletDao.seedWallet(destinationWalletId, "AED", 0);
		TransferPayload payload = new TransferPayload(sourceWalletId, destinationWalletId, 1_000);
		String idempotencyKey = DataGeneratorUtil.getIdempotencyKey();

		String transferId = transferService.createTransfer(payload, idempotencyKey).then()
				.statusCode(201).extract().path("transfer_id");
		int outboxCountAfterFirst = outboxEventDao.countAllEvents();

		transferService.replayTransfer(payload, idempotencyKey).then().statusCode(201);

		Assert.assertEquals(outboxEventDao.countAllEvents(), outboxCountAfterFirst,
				"a replayed duplicate must not emit a second outbox event");
		Assert.assertEquals(transferEventDao.getEventTypes(transferId),
				List.of(EventType.TRANSFER_REQUESTED.getValue(), EventType.TRANSFER_COMPLETED.getValue()),
				"a replayed duplicate must not append additional audit events");
	}

	@Test(description = "Verifying a validation failure leaves no contradictory or partial records in any table", groups = {
			"api", "regression" })
	public void validationFailureLeavesNoPartialRecordsTest() {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 10_000);
		int transfersBefore = transferDao.countAllTransfers();
		int outboxBefore = outboxEventDao.countAllEvents();

		// source == destination is a validation error (400); nothing should be touched anywhere
		transferService.createTransfer(new TransferPayload(sourceWalletId, sourceWalletId, 1_000),
				DataGeneratorUtil.getIdempotencyKey()).then().statusCode(400);

		Assert.assertEquals(transferDao.countAllTransfers(), transfersBefore);
		Assert.assertEquals(outboxEventDao.countAllEvents(), outboxBefore);
		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 10_000);
	}
}
