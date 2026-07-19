package com.kulu.wallet.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.kulu.wallet.db.Database;
import com.kulu.wallet.domain.ErrorResponse;
import com.kulu.wallet.domain.TransferRequest;
import com.kulu.wallet.domain.TransferResponse;
import com.kulu.wallet.domain.Wallet;
import com.kulu.wallet.service.TransferService;
import io.javalin.Javalin;
import io.javalin.http.Context;
import io.javalin.json.JavalinJackson;
import java.util.Map;

public final class WalletTransferApp {
  private final Javalin app;
  private final TransferService transferService;
  private final Database database;
  private final ObjectMapper objectMapper;

  public WalletTransferApp(Database database) {
    this.database = database;
    this.objectMapper = new ObjectMapper();
    this.transferService = new TransferService(database, objectMapper);
    this.app =
        Javalin.create(
            config -> {
              config.showJavalinBanner = false;
              config.jsonMapper(new JavalinJackson(objectMapper, true));
            });
    registerRoutes();
  }

  public static WalletTransferApp createStarted(int port) {
    Database database = Database.inMemory();
    database.migrate();
    WalletTransferApp app = new WalletTransferApp(database);
    app.app.start(port);
    return app;
  }

  public Javalin javalin() {
    return app;
  }

  public TransferService service() {
    return transferService;
  }

  public Database database() {
    return database;
  }

  public void stop() {
    app.stop();
  }

  private void registerRoutes() {
    app.get("/health", ctx -> ctx.json(Map.of("status", "UP")));

    app.post("/transfers", this::createTransfer);
    app.get("/transfers/{transfer_id}", this::getTransfer);
    app.get("/wallets/{wallet_id}", this::getWallet);
  }

  private void createTransfer(Context ctx) {
    String idempotencyKey = ctx.header("Idempotency-Key");
    TransferRequest request;
    try {
      request = ctx.bodyAsClass(TransferRequest.class);
    } catch (Exception e) {
      ctx.status(400).json(new ErrorResponse("invalid_json", "Request body must be valid JSON"));
      return;
    }

    TransferService.ServiceResult result = transferService.createTransfer(idempotencyKey, request);
    ctx.status(result.status()).contentType("application/json").result(result.body());
  }

  private void getTransfer(Context ctx) {
    String transferId = ctx.pathParam("transfer_id");
    transferService
        .getTransfer(transferId)
        .ifPresentOrElse(
            transfer -> ctx.status(200).json(TransferResponse.from(transfer)),
            () ->
                ctx.status(404)
                    .json(new ErrorResponse("not_found", "Transfer not found: " + transferId)));
  }

  private void getWallet(Context ctx) {
    String walletId = ctx.pathParam("wallet_id");
    transferService
        .getWallet(walletId)
        .ifPresentOrElse(
            wallet -> ctx.status(200).json(toWalletJson(wallet)),
            () ->
                ctx.status(404)
                    .json(new ErrorResponse("not_found", "Wallet not found: " + walletId)));
  }

  private static Map<String, Object> toWalletJson(Wallet wallet) {
    return Map.of(
        "wallet_id", wallet.id(),
        "currency", wallet.currency(),
        "balance", wallet.balance());
  }

  public static void main(String[] args) {
    int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
    WalletTransferApp app = createStarted(port);
    Runtime.getRuntime().addShutdownHook(new Thread(app::stop));
    System.out.println("Wallet Transfer Service listening on http://localhost:" + port);
  }
}
