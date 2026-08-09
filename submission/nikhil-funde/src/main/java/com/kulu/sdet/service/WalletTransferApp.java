package com.kulu.sdet.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kulu.sdet.service.model.ServiceResult;
import com.kulu.sdet.service.model.TransferRequest;
import io.javalin.Javalin;
import io.javalin.http.Context;
import io.javalin.http.HttpStatus;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Map;

public class WalletTransferApp implements AutoCloseable {

  private final String jdbcUrl;
  private Connection connection;
  private TransferService transferService;
  private Javalin app;
  private final ObjectMapper objectMapper = new ObjectMapper();

  public WalletTransferApp() {
    this("jdbc:h2:mem:wallet_" + System.nanoTime() + ";DB_CLOSE_DELAY=-1");
  }

  public WalletTransferApp(String jdbcUrl) {
    this.jdbcUrl = jdbcUrl;
  }

  public void start(int port) throws SQLException {
    connection = DriverManager.getConnection(jdbcUrl, "sa", "");
    connection.setAutoCommit(false);
    SchemaInitializer.initSchema(connection);
    connection.commit();
    transferService = new TransferService(connection);

    app =
        Javalin.create(
            config -> {
              config.showJavalinBanner = false;
              config.requestLogger.http(
                  (ctx, ms) -> {
                    /* suppress */
                  });
            });

    app.get("/wallets/{walletId}", this::getWallet);
    app.get("/transfers/{transferId}", this::getTransfer);
    app.post("/transfers", this::createTransfer);

    app.start(port);
  }

  public void stop() {
    if (app != null) {
      app.stop();
      app = null;
    }
  }

  public Connection getConnection() {
    return connection;
  }

  public String getJdbcUrl() {
    return jdbcUrl;
  }

  public int port() {
    return app != null ? app.port() : -1;
  }

  public void seedWallet(String id, long balance, String currency) throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement(
            "INSERT INTO wallets (id, balance, currency) VALUES (?, ?, ?)")) {
      stmt.setString(1, id);
      stmt.setLong(2, balance);
      stmt.setString(3, currency);
      stmt.executeUpdate();
      connection.commit();
    }
  }

  private void getWallet(Context ctx) throws SQLException {
    String walletId = ctx.pathParam("walletId");
    Map<String, Object> wallet = transferService.getWallet(walletId);
    if (wallet == null) {
      ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "wallet not found"));
      return;
    }
    ctx.status(HttpStatus.OK).json(wallet);
  }

  private void getTransfer(Context ctx) throws SQLException {
    String transferId = ctx.pathParam("transferId");
    Map<String, Object> transfer = transferService.getTransfer(transferId);
    if (transfer == null) {
      ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "transfer not found"));
      return;
    }
    ctx.status(HttpStatus.OK).json(transfer);
  }

  private void createTransfer(Context ctx) {
    try {
      String idempotencyKey = ctx.header("Idempotency-Key");
      TransferRequest request = objectMapper.readValue(ctx.body(), TransferRequest.class);
      ServiceResult result = transferService.createTransfer(request, idempotencyKey);
      ctx.status(result.statusCode()).json(result.body());
    } catch (Exception e) {
      throw new RuntimeException("Failed to process transfer", e);
    }
  }

  @Override
  public void close() {
    stop();
    if (connection != null) {
      try {
        connection.close();
      } catch (SQLException ignored) {
        // best effort
      }
      connection = null;
    }
  }
}
