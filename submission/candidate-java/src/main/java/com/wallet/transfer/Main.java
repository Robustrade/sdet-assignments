package com.wallet.transfer;

import com.wallet.transfer.controller.TransferController;
import com.wallet.transfer.repository.AuditRepository;
import com.wallet.transfer.repository.IdempotencyRepository;
import com.wallet.transfer.repository.InMemoryAuditRepository;
import com.wallet.transfer.repository.InMemoryIdempotencyRepository;
import com.wallet.transfer.repository.InMemoryOutboxRepository;
import com.wallet.transfer.repository.InMemoryTransferRepository;
import com.wallet.transfer.repository.InMemoryWalletRepository;
import com.wallet.transfer.repository.OutboxRepository;
import com.wallet.transfer.repository.TransferRepository;
import com.wallet.transfer.repository.WalletRepository;
import com.wallet.transfer.service.TransferService;
import io.javalin.Javalin;
import io.javalin.json.JavalinJackson;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Currency;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class Main {
  private static final Logger log = LoggerFactory.getLogger(Main.class);
  public static final int PORT = 8080;

  public static void main(String[] args) {
    WalletRepository walletRepository = new InMemoryWalletRepository();
    TransferRepository transferRepository = new InMemoryTransferRepository();
    AuditRepository auditRepository = new InMemoryAuditRepository();
    OutboxRepository outboxRepository = new InMemoryOutboxRepository();
    IdempotencyRepository idempotencyRepository = new InMemoryIdempotencyRepository();

    seedWallets(walletRepository);

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

    transferController.registerRoutes(app);

    log.info("Server started on port {}", PORT);
  }

  private static void seedWallets(WalletRepository walletRepository) {
    Currency aed = Currency.getInstance("INR");

    var wallet1 =
        new com.wallet.transfer.model.Wallet(
            "wallet_001",
            new BigDecimal("10000.00"),
            aed.getCurrencyCode(),
            Instant.now(),
            Instant.now());

    var wallet2 =
        new com.wallet.transfer.model.Wallet(
            "wallet_002",
            new BigDecimal("5000.00"),
            aed.getCurrencyCode(),
            Instant.now(),
            Instant.now());

    var wallet3 =
        new com.wallet.transfer.model.Wallet(
            "wallet_003",
            new BigDecimal("2000.00"),
            aed.getCurrencyCode(),
            Instant.now(),
            Instant.now());

    walletRepository.save(wallet1);
    walletRepository.save(wallet2);
    walletRepository.save(wallet3);

    System.out.println(
        "Seeded wallets: wallet_001 (10000 INR), wallet_002 (5000 INR), wallet_003 (2000 INR)");
  }
}
