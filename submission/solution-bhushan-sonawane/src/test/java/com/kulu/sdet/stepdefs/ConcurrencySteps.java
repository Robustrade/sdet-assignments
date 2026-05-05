package com.kulu.sdet.stepdefs;

import com.kulu.sdet.api.TransferApiClient;
import com.kulu.sdet.util.ConcurrentExecutor;
import io.cucumber.java.en.When;

public class ConcurrencySteps {

  private final TransferApiClient api = new TransferApiClient();

  @When("two concurrent transfers from {string} to {string} of {int} AED are executed")
  public void twoConcurrentTransfers(String source, String destination, int amount) {
    Runnable t1 = () -> api.createTransfer(source, destination, amount, "con-001");
    Runnable t2 = () -> api.createTransfer(source, destination, amount, "con-002");

    ConcurrentExecutor.run(t1, t2);
  }

  @When(
      "two concurrent transfers from {string} to {string} of {int} AED with same idempotency key {string}")
  public void twoConcurrentTransfersWithSameIdempotencyKey(
      String source, String destination, int amount, String idempotencyKey) {
    Runnable t1 = () -> api.createTransfer(source, destination, amount, idempotencyKey);
    Runnable t2 = () -> api.createTransfer(source, destination, amount, idempotencyKey);
    ConcurrentExecutor.run(t1, t2);
  }
}
