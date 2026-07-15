package com.kulu.sdet.api;

import com.kulu.sdet.domain.ApiError;
import com.kulu.sdet.domain.TransferRequest;
import com.kulu.sdet.service.TransferService;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class TransferController {

  private final TransferService service;
  private final com.kulu.sdet.repo.WalletRepo wallets;
  private final com.kulu.sdet.repo.TransferRepo transfers;

  public TransferController(
      TransferService service,
      com.kulu.sdet.repo.WalletRepo wallets,
      com.kulu.sdet.repo.TransferRepo transfers) {
    this.service = service;
    this.wallets = wallets;
    this.transfers = transfers;
  }

  @PostMapping(path = "/transfers")
  public ResponseEntity<?> createTransfer(
      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
      @RequestBody(required = false) TransferRequest body) {

    TransferService.Result result = service.execute(body, idempotencyKey);

    if (result instanceof TransferService.PersistedReplay replay) {
      // Return the stored JSON verbatim so replayed responses are byte-identical.
      return ResponseEntity.status(replay.status())
          .contentType(MediaType.APPLICATION_JSON)
          .header("Idempotent-Replay", "true")
          .body(replay.bodyJson().getBytes(StandardCharsets.UTF_8));
    }
    return ResponseEntity.status(result.status()).body(result.body());
  }

  @GetMapping("/transfers/{id}")
  public ResponseEntity<?> getTransfer(@PathVariable String id) {
    return transfers
        .findById(id)
        .<ResponseEntity<?>>map(ResponseEntity::ok)
        .orElseGet(
            () ->
                ResponseEntity.status(404)
                    .body(ApiError.of("transfer_not_found", "transfer not found: " + id)));
  }

  @GetMapping("/wallets/{id}")
  public ResponseEntity<?> getWallet(@PathVariable String id) {
    return wallets
        .findById(id)
        .<ResponseEntity<?>>map(ResponseEntity::ok)
        .orElseGet(
            () ->
                ResponseEntity.status(404)
                    .body(ApiError.of("wallet_not_found", "wallet not found: " + id)));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ApiError> handleUnparseable(HttpMessageNotReadableException e) {
    return ResponseEntity.status(422)
        .body(ApiError.of("invalid_payload", "request body could not be parsed"));
  }
}
