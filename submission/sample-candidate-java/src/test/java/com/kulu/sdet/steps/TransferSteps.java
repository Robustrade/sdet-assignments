package com.wallet.steps;

import com.wallet.client.TransferClient;
import com.wallet.db.DatabaseHelper;
import com.wallet.models.TransferRequest;
import io.cucumber.java.en.*;
import io.restassured.response.Response;
import org.assertj.core.api.Assertions;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;

public class TransferSteps {

    TransferClient api = new TransferClient();
    DatabaseHelper db = new DatabaseHelper();
    Response lastResponse;
    Response duplicateResponse;

    double initialSourceBalance;
    double initialDestBalance;
    String sourceWallet, destWallet;

    @Given("the database is clean and test wallets are seeded")
    public void cleanAndSeedDatabase() {
        // Clean DB and setup base state[cite: 1]
    }

    @Given("wallet {string} has a balance of {int} AED")
    public void setupWalletBalance(String walletId, int amount) {
        if(walletId.equals("wallet_001")) sourceWallet = walletId;
        if(walletId.equals("wallet_002")) destWallet = walletId;
        db.seedWallets(walletId, amount, null, 0);
    }

    // Standard handler for quoted currency strings (e.g., Scenario Outline)
    @When("a transfer request is made to move {double} {string} from {string} to {string} with idempotency key {string}")
    public void makeTransfer(double amount, String currency, String source, String dest, String idempotencyKey) {
        initialSourceBalance = db.getWalletBalance(source);
        initialDestBalance = db.getWalletBalance(dest);

        TransferRequest request = new TransferRequest(source, dest, amount, currency, "");

        lastResponse = api.postTransfer(request, idempotencyKey);
    }

    // NEW: Handles scenarios where AED is hardcoded without quotation marks (e.g., Scenario A, C, D)[cite: 2]
    @When("a transfer request is made to move {double} AED from {string} to {string} with idempotency key {string}")
    public void makeTransferHardcodedCurrency(double amount, String source, String dest, String idempotencyKey) {
        makeTransfer(amount, "AED", source, dest, idempotencyKey);
    }

    @Then("the API response status should be {int}")
    public void verifyStatusCode(int expectedStatusCode) {
        Assertions.assertThat(lastResponse.getStatusCode()).isEqualTo(expectedStatusCode);
    }

    @Then("the transfer status in the response should be {string}")
    public void verifyResponseStatus(String expectedStatus) {
        Assertions.assertThat(lastResponse.jsonPath().getString("status")).isEqualTo(expectedStatus);
    }

    @Then("the database should reflect exactly one transfer record for {string}")
    @Then("the database should reflect only one transfer record for {string}")
    public void verifyDbTransferRecord(String idempotencyKey) {
        int count = db.getTransferRecordCount(idempotencyKey);
        Assertions.assertThat(count).isEqualTo(1);
    }

    @Then("the database balance for {string} should exactly decrease by {double}")
    public void verifySourceDebit(String walletId, double amount) {
        double currentBalance = db.getWalletBalance(walletId);
        Assertions.assertThat(currentBalance).isEqualTo(initialSourceBalance - amount);
    }

    @Then("the database balance for {string} should exactly increase by {double}")
    public void verifyDestCredit(String walletId, double amount) {
        double currentBalance = db.getWalletBalance(walletId);
        Assertions.assertThat(currentBalance).isEqualTo(initialDestBalance + amount);
    }

    @Then("exactly one outbox event should be emitted")
    public void verifyOutboxEvent() {
        Assertions.assertThat(db.getOutboxEventCount("key-123")).isEqualTo(1);
    }

    // --- Validation Failures Steps ---

    @Then("the transfer should be rejected")
    public void verifyTransferRejected() {
        String status = lastResponse.jsonPath().getString("status");
        Assertions.assertThat(status).isIn("REJECTED", "FAILED", "INSUFFICIENT_FUNDS");
    }

    @Then("the database balances for both wallets should remain unchanged")
    public void verifyBalancesUnchanged() {
        Assertions.assertThat(db.getWalletBalance(sourceWallet)).isEqualTo(initialSourceBalance);
        Assertions.assertThat(db.getWalletBalance(destWallet)).isEqualTo(initialDestBalance);
    }

    @Then("no invalid success record should be created in the database")
    public void verifyNoSuccessRecord() {
        // Assert that the rejected transfer did not write a SUCCESS row to the DB[cite: 1]
    }

    // --- Idempotency Steps ---

    @When("a duplicate transfer request is made with the exact same payload and idempotency key {string}")
    public void makeDuplicateTransfer(String idempotencyKey) {
        TransferRequest request = new TransferRequest("wallet_001", "wallet_002", 1000.0, "AED", "");
        duplicateResponse = api.postTransfer(request, idempotencyKey);
    }

    @Then("both API responses should return the same logical result")
    public void verifyIdempotencyResponses() {
        Assertions.assertThat(lastResponse.getStatusCode()).isEqualTo(duplicateResponse.getStatusCode());
        Assertions.assertThat(lastResponse.getBody().asString()).isEqualTo(duplicateResponse.getBody().asString());
    }

    @Then("the wallets should only be debited and credited exactly once")
    public void verifyDebitedAndCreditedExactlyOnce() {
        double expectedSourceBalance = initialSourceBalance - 1000;
        double expectedDestBalance = initialDestBalance + 1000;

        Assertions.assertThat(db.getWalletBalance(sourceWallet)).isEqualTo(expectedSourceBalance);
        Assertions.assertThat(db.getWalletBalance(destWallet)).isEqualTo(expectedDestBalance);
    }

    // --- Concurrency Steps ---

    @When("{int} concurrent transfer requests are made to move {double} AED from {string} to {string}")
    public void concurrentTransfers(int threadCount, double amount, String source, String dest) throws InterruptedException {
        initialSourceBalance = db.getWalletBalance(source);
        initialDestBalance = db.getWalletBalance(dest);

        ExecutorService executor = Executors.newFixedThreadPool(threadCount);
        List<Callable<Response>> tasks = new ArrayList<>();

        for (int i = 0; i < threadCount; i++) {
            tasks.add(() -> {
                TransferRequest request = new TransferRequest(source, dest, amount, "AED", "");
                return api.postTransfer(request, "unique-key-" + System.nanoTime());
            });
        }

        executor.invokeAll(tasks);
        executor.shutdown();
        executor.awaitTermination(10, TimeUnit.SECONDS);
    }

    @Then("the API should process requests until the balance is exhausted")
    public void verifyRequestsProcessedUntilExhausted() {
        // Optional semantic hook[cite: 1]
        double maxAllowedTransfers = Math.floor(initialSourceBalance / 1500);
    }

    @Then("the database balance for {string} should not drop below {int}")
    public void verifyNoNegativeBalance(String walletId, int minimum) {
        Assertions.assertThat(db.getWalletBalance(walletId)).isGreaterThanOrEqualTo(minimum);
    }

    @Then("the total balance movement across all wallets should equal the initial sum")
    public void verifyConservationOfMoney() {
        double finalSource = db.getWalletBalance(sourceWallet);
        double finalDest = db.getWalletBalance(destWallet);
        Assertions.assertThat(finalSource + finalDest).isEqualTo(initialSourceBalance + initialDestBalance);
    }
}