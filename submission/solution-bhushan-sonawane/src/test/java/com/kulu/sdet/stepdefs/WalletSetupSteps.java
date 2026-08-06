package com.kulu.sdet.stepdefs;

import com.kulu.sdet.util.DbUtil;
import io.cucumber.java.en.Given;

public class WalletSetupSteps {

  @Given("wallet {string} has {int} AED")
  public void walletHasBalance(String walletId, int balance) {
    DbUtil.execute(
        "INSERT INTO wallets (wallet_id, balance) VALUES (?, ?) "
            + "ON CONFLICT (wallet_id) DO UPDATE SET balance = ?",
        walletId,
        balance,
        balance);
  }
}
