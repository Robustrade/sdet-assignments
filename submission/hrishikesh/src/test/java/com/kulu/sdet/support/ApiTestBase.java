package com.kulu.sdet.support;

import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Base class for every integration test.
 *
 * <p>Spins up the full Spring Boot application on a random port so tests hit the real HTTP stack
 * and the real database (H2 in PostgreSQL compatibility mode). Each test starts against a freshly
 * truncated database — no cross-test leakage.
 */
@SpringBootTest(
    classes = com.kulu.sdet.WalletTransferApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
public abstract class ApiTestBase {

  @LocalServerPort protected int port;

  @Autowired protected JdbcTemplate jdbc;
  @Autowired protected WalletApiClient api;
  @Autowired protected DbAssertions db;
  @Autowired protected com.kulu.sdet.infra.NotifierStub notifier;
  @Autowired protected com.kulu.sdet.infra.OutboxRelay outboxRelay;

  @BeforeEach
  void setUpBase() {
    truncateAll();
    notifier.reset();
    RestAssured.port = port;
    RestAssured.requestSpecification =
        new RequestSpecBuilder().setContentType(ContentType.JSON).build();
    api.setPort(port);
  }

  protected void truncateAll() {
    // Order matters due to FKs.
    jdbc.execute("DELETE FROM outbox_events");
    jdbc.execute("DELETE FROM transfer_events");
    jdbc.execute("DELETE FROM idempotency_keys");
    jdbc.execute("DELETE FROM transfers");
    jdbc.execute("DELETE FROM wallets");
  }

  /** Seed a wallet with the given balance in AED. */
  protected void seedWallet(String id, long balance) {
    seedWallet(id, balance, "AED");
  }

  protected void seedWallet(String id, long balance, String currency) {
    jdbc.update(
        "INSERT INTO wallets (id, balance, currency) VALUES (?, ?, ?)", id, balance, currency);
  }
}
