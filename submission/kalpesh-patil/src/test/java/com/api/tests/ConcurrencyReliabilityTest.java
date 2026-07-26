package com.api.tests;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.testng.Assert;
import org.testng.annotations.Test;

import com.api.request.model.TransferPayload;
import com.api.utils.ConfigManager;
import com.api.utils.DataGeneratorUtil;

import io.restassured.response.Response;

/**
 * E) Concurrency and race conditions. Requests are released together through a CountDownLatch so
 * they genuinely race; Future.get uses a timeout so a deadlock fails the run instead of hanging.
 */
public class ConcurrencyReliabilityTest extends BaseAPITest {

	private static final long REQUEST_TIMEOUT_SECONDS = ConfigManager
			.getLongProperty("concurrency.request.timeout.seconds");

	@Test(description = "Verifying two concurrent transfers competing for a limited balance result in exactly one success", groups = {
			"api", "reliability", "regression" })
	public void competingTransfersLimitedBalanceExactlyOneSucceedsTest() throws Exception {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		String destination1 = DataGeneratorUtil.getWalletId();
		String destination2 = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 2_500);
		walletDao.seedWallet(destination1, "AED", 0);
		walletDao.seedWallet(destination2, "AED", 0);

		List<Callable<Response>> competingRequests = List.of(
				callableTransfer(sourceWalletId, destination1, 2_500),
				callableTransfer(sourceWalletId, destination2, 2_500));

		List<Response> responses = runConcurrently(competingRequests);

		long successCount = responses.stream().filter(r -> r.statusCode() == 201).count();
		long rejectedCount = responses.stream().filter(r -> r.statusCode() == 422).count();
		Assert.assertEquals(successCount, 1, "exactly one competing transfer should succeed");
		Assert.assertEquals(rejectedCount, 1, "the other should be rejected as insufficient funds");

		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 0, "source must never go negative or double-debit");
		long totalCredited = walletDao.getBalance(destination1) + walletDao.getBalance(destination2);
		Assert.assertEquals(totalCredited, 2_500, "only the winning transfer's amount was ever credited");
	}

	@Test(description = "Verifying concurrent duplicate requests with the same idempotency key process exactly once", groups = {
			"api", "reliability", "regression" })
	public void concurrentDuplicatesSameKeyProcessExactlyOnceTest() throws Exception {
		String sourceWalletId = DataGeneratorUtil.getWalletId();
		String destinationWalletId = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(sourceWalletId, "AED", 10_000);
		walletDao.seedWallet(destinationWalletId, "AED", 0);
		TransferPayload payload = new TransferPayload(sourceWalletId, destinationWalletId, 1_500);
		String idempotencyKey = DataGeneratorUtil.getIdempotencyKey();

		int concurrentDuplicates = 5;
		List<Callable<Response>> duplicateRequests = new ArrayList<>();
		for (int i = 0; i < concurrentDuplicates; i++) {
			duplicateRequests.add(() -> transferService.createTransfer(payload, idempotencyKey));
		}

		List<Response> responses = runConcurrently(duplicateRequests);

		List<String> distinctTransferIds = responses.stream()
				.peek(r -> Assert.assertEquals(r.statusCode(), 201))
				.map(r -> r.jsonPath().getString("transfer_id"))
				.distinct()
				.toList();
		Assert.assertEquals(distinctTransferIds.size(), 1,
				"every concurrent duplicate must resolve to the same single transfer");

		Assert.assertEquals(transferDao.countAllTransfers(), 1);
		Assert.assertEquals(walletDao.getBalance(sourceWalletId), 10_000 - 1_500);
		Assert.assertEquals(walletDao.getBalance(destinationWalletId), 1_500);
	}

	@Test(description = "Verifying opposing concurrent transfers (A->B and B->A) both complete without deadlock", groups = {
			"api", "reliability", "regression" })
	public void opposingTransfersNoDeadlockTest() throws Exception {
		String walletA = DataGeneratorUtil.getWalletId();
		String walletB = DataGeneratorUtil.getWalletId();
		walletDao.seedWallet(walletA, "AED", 5_000);
		walletDao.seedWallet(walletB, "AED", 5_000);

		List<Callable<Response>> opposingRequests = List.of(
				callableTransfer(walletA, walletB, 1_000),
				callableTransfer(walletB, walletA, 500));

		List<Response> responses = runConcurrently(opposingRequests);

		for (Response response : responses) {
			Assert.assertEquals(response.statusCode(), 201,
					"ordered row locking must prevent a deadlock between opposing transfers");
		}
		Assert.assertEquals(walletDao.getBalance(walletA), 5_000 - 1_000 + 500);
		Assert.assertEquals(walletDao.getBalance(walletB), 5_000 - 500 + 1_000);
	}

	private Callable<Response> callableTransfer(String sourceWalletId, String destinationWalletId, long amount) {
		TransferPayload payload = new TransferPayload(sourceWalletId, destinationWalletId, amount);
		String idempotencyKey = DataGeneratorUtil.getIdempotencyKey();
		return () -> transferService.createTransfer(payload, idempotencyKey);
	}

	/** Releases every task through a shared starting gate so they race genuinely concurrently. */
	private List<Response> runConcurrently(List<Callable<Response>> tasks) throws Exception {
		CountDownLatch startingGate = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(tasks.size());
		try {
			List<Future<Response>> futures = new ArrayList<>();
			for (Callable<Response> task : tasks) {
				futures.add(executor.submit(() -> {
					startingGate.await();
					return task.call();
				}));
			}
			startingGate.countDown();

			List<Response> responses = new ArrayList<>();
			for (Future<Response> future : futures) {
				responses.add(future.get(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS));
			}
			return responses;
		} finally {
			executor.shutdownNow();
		}
	}
}
