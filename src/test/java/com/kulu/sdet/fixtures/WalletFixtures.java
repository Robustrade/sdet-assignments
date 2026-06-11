package com.kulu.sdet.fixtures;

import com.kulu.sdet.model.TransferRequest;

import java.math.BigDecimal;

public final class WalletFixtures {


    public static final String WALLET_ALPHA = "wallet-alpha-001";
    public static final String WALLET_BETA = "wallet-beta-002";


    public static final BigDecimal DEFAULT_BALANCE = new BigDecimal("1000.00");
    public static final BigDecimal SMALL_TRANSFER = new BigDecimal("10.00");
    public static final BigDecimal LARGE_TRANSFER = new BigDecimal("999.99");
    public static final BigDecimal OVER_LIMIT = new BigDecimal("9999999.00");

    private WalletFixtures() {
    }


    public static TransferRequest.Builder validTransfer() {
        return new TransferRequest.Builder()
                .from(WALLET_ALPHA)
                .to(WALLET_BETA)
                .amount(SMALL_TRANSFER)
                .currency("USD");
    }


    public static TransferRequest.Builder transfer(String fromId, String toId, BigDecimal amount) {
        return new TransferRequest.Builder()
                .from(fromId)
                .to(toId)
                .amount(amount)
                .currency("USD");
    }


    public static String insertWalletSql() {
        return "INSERT INTO wallets (id, owner_id, balance, currency) VALUES (?, ?, ?, ?)";
    }


    public static String insertTransactionSql() {
        return "INSERT INTO transactions (id, from_wallet_id, to_wallet_id, amount, currency, status) "
                + "VALUES (?, ?, ?, ?, ?, ?)";
    }


    public static String[] schemaDdl() {
        return new String[]{
                """
            CREATE TABLE IF NOT EXISTS wallets (
                id          VARCHAR(64)    PRIMARY KEY,
                owner_id    VARCHAR(64)    NOT NULL,
                balance     NUMERIC(18, 2) NOT NULL,
                currency    VARCHAR(3)     NOT NULL DEFAULT 'USD'
            )""",

                """
            CREATE TABLE IF NOT EXISTS transactions (
                id              VARCHAR(64)    PRIMARY KEY,
                from_wallet_id  VARCHAR(64)    NOT NULL REFERENCES wallets(id),
                to_wallet_id    VARCHAR(64)    NOT NULL REFERENCES wallets(id),
                amount          NUMERIC(18, 2) NOT NULL,
                currency        VARCHAR(3)     NOT NULL,
                status          VARCHAR(16)    NOT NULL,
                created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
            )""",

                """
            CREATE TABLE IF NOT EXISTS idempotency_keys (
                key            VARCHAR(128) PRIMARY KEY,
                request_hash   VARCHAR(128) NOT NULL,
                status_code    INT,
                transaction_id VARCHAR(64),
                response_body  TEXT,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",


                """
            CREATE TABLE IF NOT EXISTS audit_events (
                id            VARCHAR(64)  PRIMARY KEY,
                event_type    VARCHAR(64)  NOT NULL,
                actor_id      VARCHAR(64),
                resource_type VARCHAR(64)  NOT NULL,
                resource_id   VARCHAR(64)  NOT NULL,
                details       TEXT,
                occurred_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )""",


                """
            CREATE TABLE IF NOT EXISTS outbox_events (
                id            VARCHAR(64)  PRIMARY KEY,
                event_type    VARCHAR(64)  NOT NULL,
                aggregate_id  VARCHAR(64)  NOT NULL,
                payload       TEXT         NOT NULL,
                published_at  TIMESTAMPTZ,
                created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )"""
        };
    }
}
