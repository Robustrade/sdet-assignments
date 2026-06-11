package com.kulu.sdet.support;

public final class TestConfig {


    public static final String BASE_URL = System.getProperty("wallet.base.url", System.getenv().getOrDefault("WALLET_BASE_URL", "http://localhost:8080"));

    public static final String API_VERSION = System.getProperty("wallet.api.version", "v1");


    public static final String WALLET_BASE_PATH = "/" + API_VERSION + "/wallets";


    public static final String DB_IMAGE = System.getProperty("db.image", "postgres:16-alpine");

    public static final String DB_NAME = "walletdb";
    public static final String DB_USER = "sdet";
    public static final String DB_PASS = "sdet_pass";


    public static final int CONNECTION_TIMEOUT_MS = 5_000;
    public static final int READ_TIMEOUT_MS = 10_000;

    private TestConfig() {
    }
}
