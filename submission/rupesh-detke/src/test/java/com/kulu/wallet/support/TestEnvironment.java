package com.kulu.wallet.support;

import com.kulu.wallet.api.WalletTransferApp;
import com.kulu.wallet.db.Database;
import com.kulu.wallet.db.EventRepository;
import com.kulu.wallet.db.IdempotencyRepository;
import com.kulu.wallet.db.TransferRepository;
import com.kulu.wallet.db.WalletRepository;
import java.sql.Connection;
import java.sql.SQLException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

public abstract class TestEnvironment {
  protected WalletTransferApp app;
  protected String baseUrl;
  protected TransferApiClient api;
  protected DbAssertions db;
  protected WalletRepository walletRepository = new WalletRepository();
  protected TransferRepository transferRepository = new TransferRepository();
  protected IdempotencyRepository idempotencyRepository = new IdempotencyRepository();
  protected EventRepository eventRepository = new EventRepository();

  @BeforeEach
  void startApp() {
    Database database = Database.inMemory();
    database.migrate();
    app = new WalletTransferApp(database);
    app.javalin().start(0);
    int port = app.javalin().port();
    baseUrl = "http://localhost:" + port;
    api = new TransferApiClient(baseUrl);
    db =
        new DbAssertions(
            database, walletRepository, transferRepository, idempotencyRepository, eventRepository);
  }

  @AfterEach
  void stopApp() {
    if (app != null) {
      app.stop();
    }
  }

  protected void seedWallet(String id, String currency, long balance) {
    app.service().seedWallet(id, currency, balance);
  }

  protected Database database() {
    return app.database();
  }

  protected Connection connection() throws SQLException {
    return database().getConnection();
  }
}
