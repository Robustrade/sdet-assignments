package com.kulu.sdet.support;

import com.kulu.sdet.fixtures.WalletFixtures;
import com.kulu.sdet.model.Wallet;

public final class DatabaseSeeder {

    private DatabaseSeeder() {
    }


    public static void applySchema(DbClient db) throws Exception {
        for (String ddl : WalletFixtures.schemaDdl()) {
            db.execute(ddl);
        }
        db.commit();
    }


    public static void seedWallets(DbClient db, Wallet... wallets) throws Exception {
        for (Wallet w : wallets) {
            db.execute(WalletFixtures.insertWalletSql(), w.toInsertArgs());
        }
        db.commit();
    }
}
