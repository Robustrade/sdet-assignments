package com.robustrade.wallet.support;

import com.robustrade.wallet.dao.WalletDao;
import com.robustrade.wallet.db.Database;
import com.robustrade.wallet.dto.TransferRequestDto;
import com.robustrade.wallet.model.Wallet;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;

/**
 * Builds test preconditions without repeating boilerplate in every test.
 * Wallets are seeded directly via JDBC (bypassing the API) because seeding
 * is test setup, not the thing under test.
 */
public class TestData {

    private final Database database;
    private final WalletDao walletDao = new WalletDao();

    public TestData(Database database) {
        this.database = database;
    }

    /** Seeds a wallet with a random id and returns that id. */
    public String seedWallet(String currency, BigDecimal balance) {
        String id = "wallet_" + UUID.randomUUID().toString().substring(0, 8);
        seedWallet(id, currency, balance);
        return id;
    }

    public void seedWallet(String id, String currency, BigDecimal balance) {
        try (Connection conn = database.getConnection()) {
            walletDao.insert(conn, new Wallet(id, currency, balance));
        } catch (SQLException e) {
            throw new RuntimeException("Failed to seed wallet " + id, e);
        }
    }

    public static TransferRequestDto transferRequest(String source, String destination,
                                                       BigDecimal amount, String currency) {
        TransferRequestDto dto = new TransferRequestDto();
        dto.sourceWalletId = source;
        dto.destinationWalletId = destination;
        dto.amount = amount;
        dto.currency = currency;
        dto.reference = "ref_" + UUID.randomUUID().toString().substring(0, 8);
        return dto;
    }

    public static String newIdempotencyKey() {
        return UUID.randomUUID().toString();
    }
}
