package com.kulu.wallet.workflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.wallet.support.TestEnvironment;
import com.kulu.wallet.support.TransferRequestBuilder;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class InsufficientBalanceTest extends TestEnvironment {

  @Test
  void insufficientBalanceRejectsWithoutMutatingBalancesOrWritingOutbox() {
    seedWallet("wallet_001", "AED", 100);
    seedWallet("wallet_002", "AED", 500);

    var response =
        api.createTransfer(
            UUID.randomUUID().toString(), TransferRequestBuilder.aTransfer().amount(2500).build());

    assertThat(response.statusCode()).isEqualTo(422);
    assertThat(response.jsonPath().getString("status")).isEqualTo("REJECTED_INSUFFICIENT_FUNDS");
    String transferId = response.jsonPath().getString("transfer_id");

    db.assertBalances("wallet_001", 100, "wallet_002", 500);
    db.assertRejectedInsufficientFunds(transferId);
    db.assertTransferCount(1);
    db.assertOutboxCount(0);
  }
}
