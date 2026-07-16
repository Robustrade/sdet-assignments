package com.wallet.transfer;

import com.wallet.transfer.controller.TransferController;
import com.wallet.transfer.repository.InMemoryAuditRepository;
import com.wallet.transfer.repository.InMemoryIdempotencyRepository;
import com.wallet.transfer.repository.InMemoryOutboxRepository;
import com.wallet.transfer.repository.InMemoryTransferRepository;
import com.wallet.transfer.repository.InMemoryWalletRepository;
import com.wallet.transfer.repository.WalletRepository;
import com.wallet.transfer.service.TransferService;
import io.javalin.Javalin;
import io.javalin.json.JavalinJackson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class Application {
  private static final Logger log = LoggerFactory.getLogger(Application.class);
  public static final int PORT = 8080;

  public static void main(String[] args) {
    InMemoryWalletRepository walletRepository = new InMemoryWalletRepository();
    InMemoryTransferRepository transferRepository = new InMemoryTransferRepository();
    InMemoryAuditRepository auditRepository = new InMemoryAuditRepository();
    InMemoryOutboxRepository outboxRepository = new InMemoryOutboxRepository();
    InMemoryIdempotencyRepository idempotencyRepository = new InMemoryIdempotencyRepository();

    seedInitialData(walletRepository);

    TransferService transferService =
        new TransferService(
            walletRepository,
            transferRepository,
            auditRepository,
            outboxRepository,
            idempotencyRepository);

    TransferController transferController = new TransferController(transferService);

    Javalin app =
        Javalin.create(
                config -> {
                  config.jsonMapper(new JavalinJackson());
                })
            .start(PORT);

    app.post("/transfers", transferController::createTransfer);
    app.get("/transfers/{id}", transferController::getTransfer);
    app.get("/wallets/{id}", transferController::getWallet);

    log.info("Server started on port {}", PORT);
  }

  private static void seedInitialData(WalletRepository walletRepository) {
    walletRepository.save(
        new com.wallet.transfer.model.Wallet(
            "wallet_001",
            new java.math.BigDecimal("10000.00"),
            "INR",
            java.time.Instant.now(),
            java.time.Instant.now()));
    walletRepository.save(
        new com.wallet.transfer.model.Wallet(
            "wallet_002",
            new java.math.BigDecimal("5000.00"),
            "INR",
            java.time.Instant.now(),
            java.time.Instant.now()));
    walletRepository.save(
        new com.wallet.transfer.model.Wallet(
            "wallet_003",
            new java.math.BigDecimal("2000.00"),
            "INR",
            java.time.Instant.now(),
            java.time.Instant.now()));
  }
}
