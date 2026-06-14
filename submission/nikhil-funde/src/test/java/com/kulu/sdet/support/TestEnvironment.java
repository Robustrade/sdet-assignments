package com.kulu.sdet.support;

import com.kulu.sdet.service.WalletTransferApp;
import io.restassured.RestAssured;
import org.junit.jupiter.api.extension.AfterEachCallback;
import org.junit.jupiter.api.extension.BeforeEachCallback;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.api.extension.ParameterContext;
import org.junit.jupiter.api.extension.ParameterResolver;

public class TestEnvironment implements BeforeEachCallback, AfterEachCallback, ParameterResolver {

  private static final String[][] SEED_WALLETS = {
    {"wallet_001", "10000", "AED"},
    {"wallet_002", "5000", "AED"},
    {"wallet_003", "0", "AED"}
  };

  private WalletTransferApp app;
  private TransferApiClient apiClient;
  private DatabaseVerifier databaseVerifier;

  @Override
  public void beforeEach(ExtensionContext context) throws Exception {
    app = new WalletTransferApp();
    app.start(0);
    for (String[] wallet : SEED_WALLETS) {
      app.seedWallet(wallet[0], Long.parseLong(wallet[1]), wallet[2]);
    }
    RestAssured.baseURI = "http://localhost";
    RestAssured.port = app.port();
    RestAssured.enableLoggingOfRequestAndResponseIfValidationFails();
    apiClient = new TransferApiClient();
    databaseVerifier = new DatabaseVerifier(app.getConnection());
  }

  @Override
  public void afterEach(ExtensionContext context) {
    if (app != null) {
      app.close();
      app = null;
    }
  }

  public WalletTransferApp getApp() {
    return app;
  }

  public TransferApiClient getApiClient() {
    return apiClient;
  }

  public DatabaseVerifier getDatabaseVerifier() {
    return databaseVerifier;
  }

  @Override
  public boolean supportsParameter(
      ParameterContext parameterContext, ExtensionContext extensionContext) {
    Class<?> type = parameterContext.getParameter().getType();
    return type == TransferApiClient.class
        || type == DatabaseVerifier.class
        || type == WalletTransferApp.class;
  }

  @Override
  public Object resolveParameter(
      ParameterContext parameterContext, ExtensionContext extensionContext) {
    Class<?> type = parameterContext.getParameter().getType();
    if (type == TransferApiClient.class) {
      return apiClient;
    }
    if (type == DatabaseVerifier.class) {
      return databaseVerifier;
    }
    if (type == WalletTransferApp.class) {
      return app;
    }
    throw new IllegalStateException("Unsupported parameter type: " + type);
  }
}
