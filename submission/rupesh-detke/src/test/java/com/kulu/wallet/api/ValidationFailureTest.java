package com.kulu.wallet.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.wallet.support.TestEnvironment;
import com.kulu.wallet.support.TransferRequestBuilder;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class ValidationFailureTest extends TestEnvironment {

  static Stream<Map<String, Object>> invalidBodies() {
    return Stream.of(
        TransferRequestBuilder.aTransfer().amount(0).build(),
        TransferRequestBuilder.aTransfer().amount(-10).build(),
        TransferRequestBuilder.aTransfer().from("wallet_001").to("wallet_001").build(),
        TransferRequestBuilder.aTransfer().currency("XYZ").build(),
        TransferRequestBuilder.aTransfer().reference("").build());
  }

  @ParameterizedTest
  @MethodSource("invalidBodies")
  void validationFailuresDoNotMutateBalancesOrPersistSuccess(Map<String, Object> body) {
    seedWallet("wallet_001", "AED", 5_000);
    seedWallet("wallet_002", "AED", 5_000);

    var response = api.createTransfer(UUID.randomUUID().toString(), body);

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("error")).isEqualTo("validation_error");
    db.assertBalances("wallet_001", 5_000, "wallet_002", 5_000);
    db.assertTransferCount(0);
    db.assertOutboxCount(0);
    db.assertIdempotencyCount(0);
  }

  @Test
  void missingIdempotencyKeyIsRejectedWithoutSideEffects() {
    seedWallet("wallet_001", "AED", 5_000);
    seedWallet("wallet_002", "AED", 5_000);

    var response = api.createTransfer(null, TransferRequestBuilder.aTransfer().amount(100).build());

    assertThat(response.statusCode()).isEqualTo(400);
    assertThat(response.jsonPath().getString("error")).isEqualTo("missing_idempotency_key");
    db.assertBalances("wallet_001", 5_000, "wallet_002", 5_000);
    db.assertTransferCount(0);
  }
}
