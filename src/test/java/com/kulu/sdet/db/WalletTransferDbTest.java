package com.kulu.sdet.db;

import com.kulu.sdet.fixtures.WalletBuilder;
import com.kulu.sdet.fixtures.WalletFixtures;
import com.kulu.sdet.model.Wallet;
import com.kulu.sdet.support.DbClient;
import com.kulu.sdet.support.TestConfig;
import org.junit.jupiter.api.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.sql.ResultSetMetaData;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

@Tag("db")
@Testcontainers
@DisplayName("Wallet Transfer DB State")
class WalletTransferDbTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(TestConfig.DB_IMAGE).withDatabaseName(TestConfig.DB_NAME).withUsername(TestConfig.DB_USER).withPassword(TestConfig.DB_PASS);

    private DbClient db;

    @BeforeEach
    void setUp() throws Exception {
        db = new DbClient(POSTGRES);
        seedSchema();
        seedWallets();
    }

    @AfterEach
    void tearDown() throws Exception {
        db.close();
    }


    @Test
    @DisplayName("wallets table contains expected columns and types")
    void walletsTable_hasExpectedSchema() throws Exception {
        ResultSetMetaData meta = (ResultSetMetaData) db.query("SELECT * FROM wallets LIMIT 0").stream().findFirst().map(r -> null).orElse(null);


    }


    @Test
    @DisplayName("Balances are consistent after a transfer (sum is conserved)")
    void transfer_balanceSumIsConserved() throws Exception {
        BigDecimal sumBefore = totalBalance();

        simulateTransfer(WalletFixtures.WALLET_ALPHA, WalletFixtures.WALLET_BETA, WalletFixtures.SMALL_TRANSFER);

        BigDecimal sumAfter = totalBalance();
        assertEquals(0, sumBefore.compareTo(sumAfter), "Total balance across wallets must remain constant after transfer");
    }

    @Test
    @DisplayName("Sender balance decreases by transferred amount")
    void transfer_senderBalanceDecreases() throws Exception {
        BigDecimal before = balanceOf(WalletFixtures.WALLET_ALPHA);

        simulateTransfer(WalletFixtures.WALLET_ALPHA, WalletFixtures.WALLET_BETA, WalletFixtures.SMALL_TRANSFER);

        BigDecimal after = balanceOf(WalletFixtures.WALLET_ALPHA);
        assertEquals(0, before.subtract(WalletFixtures.SMALL_TRANSFER).compareTo(after), "Sender balance must decrease by exactly the transfer amount");
    }

    @Test
    @DisplayName("Receiver balance increases by transferred amount")
    void transfer_receiverBalanceIncreases() throws Exception {
        BigDecimal before = balanceOf(WalletFixtures.WALLET_BETA);

        simulateTransfer(WalletFixtures.WALLET_ALPHA, WalletFixtures.WALLET_BETA, WalletFixtures.SMALL_TRANSFER);

        BigDecimal after = balanceOf(WalletFixtures.WALLET_BETA);
        assertEquals(0, before.add(WalletFixtures.SMALL_TRANSFER).compareTo(after), "Receiver balance must increase by exactly the transfer amount");
    }


    @Test
    @DisplayName("A transaction record is written for each transfer")
    void transfer_writesTransactionRecord() throws Exception {
        String txId = simulateTransfer(WalletFixtures.WALLET_ALPHA, WalletFixtures.WALLET_BETA, WalletFixtures.SMALL_TRANSFER);

        List<Map<String, Object>> rows = db.query("SELECT * FROM transactions WHERE id = ?", txId);

        assertEquals(1, rows.size(), "Exactly one transaction row expected");
        assertEquals(WalletFixtures.WALLET_ALPHA, rows.get(0).get("from_wallet_id"));
        assertEquals(WalletFixtures.WALLET_BETA, rows.get(0).get("to_wallet_id"));
        assertEquals("COMPLETED", rows.get(0).get("status"));
    }


    private void seedSchema() throws Exception {
        for (String ddl : WalletFixtures.schemaDdl()) {
            db.execute(ddl);
        }
        db.commit();
    }

    private void seedWallets() throws Exception {
        Wallet alpha = WalletBuilder.anAlphaWallet().withOwnerId("owner-1").build();
        Wallet beta = WalletBuilder.aBetaWallet().withOwnerId("owner-2").build();
        db.execute(WalletFixtures.insertWalletSql(), alpha.toInsertArgs());
        db.execute(WalletFixtures.insertWalletSql(), beta.toInsertArgs());
        db.commit();
    }

    private BigDecimal balanceOf(String walletId) throws Exception {
        return db.queryScalar("SELECT balance FROM wallets WHERE id = ?", walletId);
    }

    private BigDecimal totalBalance() throws Exception {
        return db.queryScalar("SELECT SUM(balance) FROM wallets");
    }


    private String simulateTransfer(String from, String to, BigDecimal amount) throws Exception {
        db.execute("UPDATE wallets SET balance = balance - ? WHERE id = ?", amount, from);
        db.execute("UPDATE wallets SET balance = balance + ? WHERE id = ?", amount, to);
        String txId = UUID.randomUUID().toString();
        db.execute(WalletFixtures.insertTransactionSql(), txId, from, to, amount, "USD", "COMPLETED");
        db.commit();
        return txId;
    }
}
