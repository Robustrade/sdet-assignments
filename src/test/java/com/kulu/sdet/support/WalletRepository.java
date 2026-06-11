package com.kulu.sdet.support;

import com.kulu.sdet.fixtures.WalletFixtures;
import com.kulu.sdet.model.Wallet;

import java.math.BigDecimal;

public class WalletRepository {

    private final DbClient db;

    public WalletRepository(DbClient db) {
        this.db = db;
    }


    public BigDecimal balanceOf(String walletId) throws Exception {
        return db.queryScalar("SELECT balance FROM wallets WHERE id = ?", walletId);
    }


    public BigDecimal totalBalance() throws Exception {
        return db.queryScalar("SELECT SUM(balance) FROM wallets");
    }


    public boolean hasNonNegativeBalance(String walletId) throws Exception {
        BigDecimal balance = balanceOf(walletId);
        return balance != null && balance.compareTo(BigDecimal.ZERO) >= 0;
    }


    public boolean exists(String walletId) throws Exception {
        Long count = db.queryScalar("SELECT COUNT(*) FROM wallets WHERE id = ?", walletId);
        return count != null && count > 0;
    }


    public void seed(Wallet wallet) throws Exception {
        db.execute(WalletFixtures.insertWalletSql(), wallet.toInsertArgs());
        db.commit();
    }


    public void seed(Wallet... wallets) throws Exception {
        for (Wallet w : wallets) {
            db.execute(WalletFixtures.insertWalletSql(), w.toInsertArgs());
        }
        db.commit();
    }
}
