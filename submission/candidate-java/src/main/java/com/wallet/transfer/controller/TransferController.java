package com.wallet.transfer.controller;

import com.wallet.transfer.dto.TransferRequest;
import com.wallet.transfer.dto.TransferResponse;
import com.wallet.transfer.dto.WalletResponse;
import com.wallet.transfer.model.TransferErrorCode;
import com.wallet.transfer.model.TransferResult;
import com.wallet.transfer.model.Wallet;
import com.wallet.transfer.service.TransferService;
import io.javalin.Javalin;
import io.javalin.http.Context;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

public class TransferController {
  private final TransferService transferService;

  public TransferController(TransferService transferService) {
    this.transferService = transferService;
  }

  public void registerRoutes(Javalin app) {
    app.post("/transfers", this::createTransfer);
    app.get("/transfers/{id}", this::getTransfer);
    app.get("/wallets/{id}", this::getWallet);
  }

  public void createTransfer(Context ctx) {
    String idempotencyKey = ctx.header("Idempotency-Key");
    if (idempotencyKey == null || idempotencyKey.isBlank()) {
      ctx.status(400)
          .json(
              errorResponse(
                  TransferErrorCode.INVALID_REQUEST, "Idempotency-Key header is required"));
      return;
    }

    TransferRequest request;
    try {
      request = ctx.bodyAsClass(TransferRequest.class);
    } catch (Exception e) {
      ctx.status(400)
          .json(errorResponse(TransferErrorCode.INVALID_REQUEST, "Invalid request body"));
      return;
    }

    if (request == null) {
      ctx.status(400)
          .json(errorResponse(TransferErrorCode.INVALID_REQUEST, "Invalid request body"));
      return;
    }

    if (request.sourceWalletId() == null
        || request.sourceWalletId().isBlank()
        || request.destinationWalletId() == null
        || request.destinationWalletId().isBlank()
        || request.currency() == null
        || request.currency().isBlank()
        || request.reference() == null
        || request.reference().isBlank()) {
      ctx.status(400)
          .json(errorResponse(TransferErrorCode.INVALID_REQUEST, "Invalid request fields"));
      return;
    }

    if (request.amount() == null || request.amount().compareTo(BigDecimal.ZERO) <= 0) {
      ctx.status(400)
          .json(
              errorResponse(TransferErrorCode.INVALID_AMOUNT, "Amount must be greater than zero"));
      return;
    }

    TransferResult result = transferService.createTransfer(idempotencyKey, request);

    if (result.isSuccess()) {
      ctx.status(201).json(result.getResponse().orElseThrow());
    } else {
      int status =
          mapErrorCodeToStatus(result.getErrorCode().orElse(TransferErrorCode.INTERNAL_ERROR));
      ctx.status(status)
          .json(errorResponse(result.getErrorCode().orElse(TransferErrorCode.INTERNAL_ERROR)));
    }
  }

  public void getTransfer(Context ctx) {
    String idParam = ctx.pathParam("id");
    UUID transferId;
    try {
      transferId = UUID.fromString(idParam);
    } catch (IllegalArgumentException e) {
      ctx.status(400)
          .json(errorResponse(TransferErrorCode.INVALID_REQUEST, "Invalid transfer ID format"));
      return;
    }

    Optional<TransferResponse> response = transferService.getTransfer(transferId);
    if (response.isPresent()) {
      ctx.json(response.get());
    } else {
      ctx.status(404).json(errorResponse(TransferErrorCode.TRANSFER_NOT_FOUND));
    }
  }

  public void getWallet(Context ctx) {
    String walletId = ctx.pathParam("id");
    Optional<Wallet> wallet = transferService.getWallet(walletId);
    if (wallet.isPresent()) {
      Wallet w = wallet.get();
      ctx.json(new WalletResponse(w.walletId(), w.balance(), w.currency(), w.createdAt()));
    } else {
      ctx.status(404).json(errorResponse(TransferErrorCode.WALLET_NOT_FOUND));
    }
  }

  private int mapErrorCodeToStatus(TransferErrorCode errorCode) {
    return switch (errorCode) {
      case INVALID_REQUEST, SAME_WALLET, INVALID_AMOUNT, INVALID_CURRENCY -> 400;
      case WALLET_NOT_FOUND, TRANSFER_NOT_FOUND -> 404;
      case INSUFFICIENT_BALANCE -> 409;
      case IDEMPOTENCY_KEY_CONFLICT -> 409;
      default -> 500;
    };
  }

  private ErrorResponse errorResponse(TransferErrorCode errorCode) {
    return new ErrorResponse(errorCode.code(), errorCode.message());
  }

  private ErrorResponse errorResponse(TransferErrorCode errorCode, String message) {
    return new ErrorResponse(errorCode.code(), message);
  }

  public record ErrorResponse(String code, String message) {}
}
