package com.wallet.transfer.fixtures;

import com.wallet.transfer.api.TransferApi;
import com.wallet.transfer.builders.WalletBuilder;
import com.wallet.transfer.controller.TransferController;
import com.wallet.transfer.model.Wallet;
import com.wallet.transfer.repository.InMemoryAuditRepository;
import com.wallet.transfer.repository.InMemoryIdempotencyRepository;
import com.wallet.transfer.repository.InMemoryOutboxRepository;
import com.wallet.transfer.repository.InMemoryTransferRepository;
import com.wallet.transfer.repository.InMemoryWalletRepository;
import com.wallet.transfer.service.TransferService;
import io.javalin.Javalin;
import io.javalin.json.JavalinJackson;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

public class TestFixture {
  protected Javalin app;
  protected TransferApi api;
  protected InMemoryWalletRepository walletRepository;
  protected InMemoryTransferRepository transferRepository;
  protected InMemoryAuditRepository auditRepository;
  protected InMemoryOutboxRepository outboxRepository;
  protected InMemoryIdempotencyRepository idempotencyRepository;
  protected TransferService transferService;
  protected int port = 8081;

  @BeforeEach
  void setUp() {
    walletRepository = new InMemoryWalletRepository();
    transferRepository = new InMemoryTransferRepository();
    auditRepository = new InMemoryAuditRepository();
    outboxRepository = new InMemoryOutboxRepository();
    idempotencyRepository = new InMemoryIdempotencyRepository();

    seedWallets();

    transferService =
        new TransferService(
            walletRepository,
            transferRepository,
            auditRepository,
            outboxRepository,
            idempotencyRepository);

    TransferController controller = new TransferController(transferService);

    app =
        Javalin.create(
                config -> {
                  config.jsonMapper(new JavalinJackson());
                })
            .start(port);

    controller.registerRoutes(app);

    api = new TransferApi("http://localhost", port);
  }

  @AfterEach
  void tearDown() {
    if (app != null) {
      app.stop();
    }
    clearRepositories();
  }

  private void seedWallets() {
    walletRepository.save(
        WalletBuilder.aWallet()
            .withWalletId("wallet_001")
            .withBalance(new java.math.BigDecimal("10000.00"))
            .build());

    walletRepository.save(
        WalletBuilder.aWallet()
            .withWalletId("wallet_002")
            .withBalance(new java.math.BigDecimal("5000.00"))
            .build());

    walletRepository.save(
        WalletBuilder.aWallet()
            .withWalletId("wallet_003")
            .withBalance(new java.math.BigDecimal("2000.00"))
            .build());
  }

  protected void clearRepositories() {
    walletRepository.clear();
    transferRepository.clear();
    auditRepository.clear();
    outboxRepository.clear();
    idempotencyRepository.clear();
  }

  protected Wallet getWallet(String walletId) {
    return walletRepository.findById(walletId).orElse(null);
  }

  protected void resetState() {
    clearRepositories();
    seedWallets();
  }
}
