package com.wallet.tests;

import com.wallet.assertions.ApiAssertions;
import com.wallet.assertions.BusinessAssertions;
import com.wallet.assertions.DatabaseAssertions;
import com.wallet.builders.WalletBuilder;
import com.wallet.client.TransferClient;
import com.wallet.client.WalletClient;
import com.wallet.db.DbClient;
import com.wallet.db.IdempotencyRepository;
import com.wallet.db.TransferRepository;
import com.wallet.db.WalletRepository;
import com.wallet.fixtures.TestCleanup;
import com.wallet.fixtures.TestDataSeeder;
import io.restassured.response.Response;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

import java.util.UUID;

import static com.wallet.assertions.ApiAssertions.assertThatResponse;

/**
 * Base class for all integration tests.
 *
 * Responsibilities:
 *  - initialises shared infrastructure (DB client, repos, clients, assertion helpers)
 *  - seeds canonical wallet data before each test
 *  - registers test cleanup after each test
 *
 * Tests should NOT repeat setup boilerplate — they inherit it here.
 */
public abstract class BaseIntegrationTest {

    // ── Infrastructure ──────────────────────────────────
    protected DbClient               db;
    protected WalletRepository       walletRepo;
    protected TransferRepository     transferRepo;
    protected IdempotencyRepository  idempotencyRepo;

    // ── Clients ─────────────────────────────────────────
    protected TransferClient  transferClient;
    protected WalletClient    walletClient;

    // ── Assertion helpers ────────────────────────────────
    protected DatabaseAssertions dbAssert;
    protected BusinessAssertions businessAssert;

    // ── Fixtures ─────────────────────────────────────────
    protected TestDataSeeder seeder;
    protected TestCleanup    cleanup;

    @BeforeEach
    void baseSetUp() {
        db              = new DbClient();
        walletRepo      = new WalletRepository(db);
        transferRepo    = new TransferRepository(db);
        idempotencyRepo = new IdempotencyRepository(db);

        transferClient = new TransferClient();
        walletClient   = new WalletClient();

        dbAssert       = new DatabaseAssertions(walletRepo, transferRepo, idempotencyRepo);
        businessAssert = new BusinessAssertions(walletRepo);

        seeder  = new TestDataSeeder(db);
        cleanup = new TestCleanup(db);

        seeder.seedWallets();
        seeder.resetBalances();
    }

    @AfterEach
    void baseTearDown() {
        cleanup.rollback();
    }

    // ── Helpers available to subclasses ──────────────────

    protected static String newIdempotencyKey() {
        return UUID.randomUUID().toString();
    }

    protected ApiAssertions post(com.wallet.model.TransferRequest req, String key) {
        Response r = transferClient.createTransfer(req, key);
        return assertThatResponse(r);
    }

    protected WalletBuilder walletWithBalance(double balance) {
        return WalletBuilder.aWallet(walletRepo).withBalance(balance);
    }
}

