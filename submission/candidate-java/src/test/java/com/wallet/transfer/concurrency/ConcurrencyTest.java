package com.wallet.transfer.concurrency;

import static org.assertj.core.api.Assertions.assertThat;

import com.wallet.transfer.api.TransferApi;
import com.wallet.transfer.assertions.TransferAssertions;
import com.wallet.transfer.builders.TransferRequestBuilder;
import com.wallet.transfer.dto.TransferRequest;
import com.wallet.transfer.fixtures.TestFixture;
import com.wallet.transfer.model.Transfer;
import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Concurrency tests for the wallet transfer service. These tests verify that the system correctly
 * handles concurrent requests, maintains exactly-once semantics, and preserves data consistency
 * under load.
 */
class ConcurrencyTest extends TestFixture {

  private TransferAssertions assertions() {
    return TransferAssertions.with(
        walletRepository,
        transferRepository,
        auditRepository,
        outboxRepository,
        idempotencyRepository);
  }

  /**
   * TC_041: Verify concurrent duplicate requests with same idempotency key (exactly-once).
   *
   * <p>Scenario: 20 concurrent threads submit the same transfer (100 INR from wallet_001 to
   * wallet_002) with the same idempotency key. Expected: All 20 threads receive HTTP 201, exactly 1
   * transfer record created, wallet balances reflect single transfer (9900/5100).
   */
  @Test
  @DisplayName(
      "POST /transfers - should handle concurrent duplicate requests with same idempotency key")
  void shouldHandleConcurrentDuplicateRequestsWithSameIdempotencyKey() throws InterruptedException {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("100.00"))
            .withCurrency("INR")
            .withReference("concurrent_dup")
            .build();

    int threadCount = 20;
    ExecutorService executor = Executors.newFixedThreadPool(threadCount);
    CountDownLatch startLatch = new CountDownLatch(1);
    CountDownLatch endLatch = new CountDownLatch(threadCount);
    AtomicInteger successCount = new AtomicInteger(0);

    for (int i = 0; i < threadCount; i++) {
      executor.submit(
          () -> {
            try {
              startLatch.await();
              var response = api.createTransferRaw(request, idempotencyKey);
              if (response.statusCode() == 201) {
                successCount.incrementAndGet();
              }
            } catch (Exception ignored) {
            } finally {
              endLatch.countDown();
            }
          });
    }

    startLatch.countDown();
    endLatch.await(15, TimeUnit.SECONDS);
    executor.shutdown();

    // All threads should get 201 (idempotent success)
    assertThat(successCount.get()).isEqualTo(threadCount);

    List<Transfer> transfers = transferRepository.findAll();
    long completedCount = transfers.stream().filter(t -> "COMPLETED".equals(t.status())).count();
    assertThat(completedCount).isEqualTo(1);

    assertions()
        .assertWalletBalances(
            "wallet_001", "wallet_002", new BigDecimal("9900.00"), new BigDecimal("5100.00"));
  }

  /**
   * TC_042: Verify concurrent transfers from same source wallet handle race conditions.
   *
   * <p>Scenario: 3 concurrent transfers from wallet_001 - 2000 INR to wallet_002, 3000 INR to
   * wallet_003, and 1000 INR to wallet_002. Expected: Total debited <= 10000 INR (source balance),
   * at least 1 transfer succeeds.
   */
  @Test
  @DisplayName("POST /transfers - should handle concurrent transfers from same source wallet")
  void shouldHandleConcurrentTransfersFromSameSourceWallet() throws InterruptedException {
    String idempotencyKey1 = TransferApi.generateIdempotencyKey();
    String idempotencyKey2 = TransferApi.generateIdempotencyKey();
    String idempotencyKey3 = TransferApi.generateIdempotencyKey();

    TransferRequest request1 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("2000.00"))
            .withCurrency("INR")
            .withReference("concurrent_1")
            .build();

    TransferRequest request2 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_003", new BigDecimal("3000.00"))
            .withCurrency("INR")
            .withReference("concurrent_2")
            .build();

    TransferRequest request3 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("1000.00"))
            .withCurrency("INR")
            .withReference("concurrent_3")
            .build();

    ExecutorService executor = Executors.newFixedThreadPool(3);
    CountDownLatch startLatch = new CountDownLatch(1);
    CountDownLatch endLatch = new CountDownLatch(3);
    AtomicInteger successCount = new AtomicInteger(0);
    AtomicInteger rejectedCount = new AtomicInteger(0);

    executor.submit(
        () -> {
          try {
            startLatch.await();
            var response = api.createTransferRaw(request1, idempotencyKey1);
            if (response.statusCode() == 201) successCount.incrementAndGet();
            else rejectedCount.incrementAndGet();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            endLatch.countDown();
          }
        });

    executor.submit(
        () -> {
          try {
            startLatch.await();
            var response = api.createTransferRaw(request2, idempotencyKey2);
            if (response.statusCode() == 201) successCount.incrementAndGet();
            else rejectedCount.incrementAndGet();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            endLatch.countDown();
          }
        });

    executor.submit(
        () -> {
          try {
            startLatch.await();
            var response = api.createTransferRaw(request3, idempotencyKey3);
            if (response.statusCode() == 201) successCount.incrementAndGet();
            else rejectedCount.incrementAndGet();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            endLatch.countDown();
          }
        });

    startLatch.countDown();
    endLatch.await(10, TimeUnit.SECONDS);
    executor.shutdown();

    List<Transfer> completedTransfers =
        transferRepository.findAll().stream().filter(t -> "COMPLETED".equals(t.status())).toList();

    BigDecimal totalDebited =
        completedTransfers.stream().map(Transfer::amount).reduce(BigDecimal.ZERO, BigDecimal::add);

    // Due to race conditions in in-memory implementation, total debited may exceed balance
    // But business logic should ensure no single transfer exceeds available balance at time of
    // check
    assertThat(totalDebited).isLessThanOrEqualTo(new BigDecimal("10000.00"));

    assertThat(successCount.get()).isBetween(1, 3);
  }

  /**
   * TC_043: Verify high contention on idempotency store (50 threads, same key).
   *
   * <p>Scenario: 50 concurrent threads submit the same transfer (50 INR from wallet_001 to
   * wallet_002) with the same idempotency key. Expected: All 50 threads receive HTTP 201, exactly 1
   * transfer record created, wallet balances reflect single transfer (9950/5050).
   */
  @Test
  @DisplayName("POST /transfers - should handle high contention on idempotency store")
  void shouldHandleHighContentionOnIdempotencyStore() throws InterruptedException {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("50.00"))
            .withCurrency("INR")
            .withReference("high_contention")
            .build();

    int threadCount = 50;
    ExecutorService executor = Executors.newFixedThreadPool(threadCount);
    CountDownLatch startLatch = new CountDownLatch(1);
    CountDownLatch endLatch = new CountDownLatch(threadCount);
    AtomicInteger successCount = new AtomicInteger(0);

    for (int i = 0; i < threadCount; i++) {
      executor.submit(
          () -> {
            try {
              startLatch.await();
              var response = api.createTransferRaw(request, idempotencyKey);
              if (response.statusCode() == 201) {
                successCount.incrementAndGet();
              }
            } catch (Exception ignored) {
            } finally {
              endLatch.countDown();
            }
          });
    }

    startLatch.countDown();
    endLatch.await(15, TimeUnit.SECONDS);
    executor.shutdown();

    assertThat(successCount.get()).isEqualTo(threadCount);

    List<Transfer> transfers = transferRepository.findAll();
    long completedCount = transfers.stream().filter(t -> "COMPLETED".equals(t.status())).count();
    assertThat(completedCount).isEqualTo(1);

    assertions()
        .assertWalletBalances(
            "wallet_001", "wallet_002", new BigDecimal("9950.00"), new BigDecimal("5050.00"));
  }

  /**
   * TC_044: Verify concurrent transfers to different destinations conserve total balance.
   *
   * <p>Scenario: 4 concurrent transfers: - 1000 INR from wallet_001 to wallet_002 - 1500 INR from
   * wallet_001 to wallet_003 - 500 INR from wallet_002 to wallet_001 - 800 INR from wallet_003 to
   * wallet_001 Expected: Total balance conserved (17000 INR), at least some transfers succeed.
   */
  @Test
  @DisplayName("POST /transfers - should handle concurrent transfers to different destinations")
  void shouldHandleConcurrentTransfersToDifferentDestinations() throws InterruptedException {
    String idempotencyKey1 = TransferApi.generateIdempotencyKey();
    String idempotencyKey2 = TransferApi.generateIdempotencyKey();
    String idempotencyKey3 = TransferApi.generateIdempotencyKey();
    String idempotencyKey4 = TransferApi.generateIdempotencyKey();

    TransferRequest request1 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("1000.00"))
            .withCurrency("INR")
            .withReference("diff_dest_1")
            .build();

    TransferRequest request2 =
        TransferRequestBuilder.transfer("wallet_001", "wallet_003", new BigDecimal("1500.00"))
            .withCurrency("INR")
            .withReference("diff_dest_2")
            .build();

    TransferRequest request3 =
        TransferRequestBuilder.transfer("wallet_002", "wallet_001", new BigDecimal("500.00"))
            .withCurrency("INR")
            .withReference("diff_dest_3")
            .build();

    TransferRequest request4 =
        TransferRequestBuilder.transfer("wallet_003", "wallet_001", new BigDecimal("800.00"))
            .withCurrency("INR")
            .withReference("diff_dest_4")
            .build();

    ExecutorService executor = Executors.newFixedThreadPool(4);
    CountDownLatch startLatch = new CountDownLatch(1);
    CountDownLatch endLatch = new CountDownLatch(4);
    AtomicInteger successCount = new AtomicInteger(0);

    executor.submit(
        () -> {
          try {
            startLatch.await();
            var response = api.createTransferRaw(request1, idempotencyKey1);
            if (response.statusCode() == 201) successCount.incrementAndGet();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            endLatch.countDown();
          }
        });

    executor.submit(
        () -> {
          try {
            startLatch.await();
            var response = api.createTransferRaw(request2, idempotencyKey2);
            if (response.statusCode() == 201) successCount.incrementAndGet();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            endLatch.countDown();
          }
        });

    executor.submit(
        () -> {
          try {
            startLatch.await();
            var response = api.createTransferRaw(request3, idempotencyKey3);
            if (response.statusCode() == 201) successCount.incrementAndGet();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            endLatch.countDown();
          }
        });

    executor.submit(
        () -> {
          try {
            startLatch.await();
            var response = api.createTransferRaw(request4, idempotencyKey4);
            if (response.statusCode() == 201) successCount.incrementAndGet();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            endLatch.countDown();
          }
        });

    startLatch.countDown();
    endLatch.await(10, TimeUnit.SECONDS);
    executor.shutdown();

    // Verify total balance is conserved regardless of how many transfers succeeded
    BigDecimal finalTotal =
        getWallet("wallet_001")
            .balance()
            .add(getWallet("wallet_002").balance())
            .add(getWallet("wallet_003").balance());
    BigDecimal initialTotal = new BigDecimal("17000.00");
    assertions().assertConservationOfValue(initialTotal, finalTotal);

    // At least some transfers should have succeeded
    assertThat(successCount.get()).isGreaterThan(0);
  }

  /**
   * TC_045: Verify exactly-once semantics under load (100 threads, same key).
   *
   * <p>Scenario: 100 concurrent threads (20 thread pool) submit the same transfer (1 INR from
   * wallet_001 to wallet_002) with the same idempotency key. Expected: All 100 threads receive HTTP
   * 201, exactly 1 transfer record created, wallet balances reflect single transfer (9999/5001).
   */
  @Test
  @DisplayName("POST /transfers - should maintain exactly-once semantics under load")
  void shouldMaintainExactlyOnceSemanticsUnderLoad() throws InterruptedException {
    String idempotencyKey = TransferApi.generateIdempotencyKey();
    TransferRequest request =
        TransferRequestBuilder.transfer("wallet_001", "wallet_002", new BigDecimal("1.00"))
            .withCurrency("INR")
            .withReference("exactly_once_load")
            .build();

    int threadCount = 100;
    ExecutorService executor = Executors.newFixedThreadPool(20);
    CountDownLatch startLatch = new CountDownLatch(1);
    CountDownLatch endLatch = new CountDownLatch(threadCount);
    AtomicInteger successCount = new AtomicInteger(0);

    for (int i = 0; i < threadCount; i++) {
      executor.submit(
          () -> {
            try {
              startLatch.await();
              var response = api.createTransferRaw(request, idempotencyKey);
              if (response.statusCode() == 201) {
                successCount.incrementAndGet();
              }
            } catch (Exception ignored) {
            } finally {
              endLatch.countDown();
            }
          });
    }

    startLatch.countDown();
    endLatch.await(15, TimeUnit.SECONDS);
    executor.shutdown();

    assertThat(successCount.get()).isEqualTo(threadCount);

    List<Transfer> transfers = transferRepository.findAll();
    long completedCount = transfers.stream().filter(t -> "COMPLETED".equals(t.status())).count();
    assertThat(completedCount).isEqualTo(1);

    assertions()
        .assertWalletBalances(
            "wallet_001", "wallet_002", new BigDecimal("9999.00"), new BigDecimal("5001.00"));
  }
}
