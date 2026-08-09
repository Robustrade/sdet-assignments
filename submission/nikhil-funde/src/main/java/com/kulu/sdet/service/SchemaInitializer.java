package com.kulu.sdet.service;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

public final class SchemaInitializer {

  private SchemaInitializer() {}

  public static void initSchema(Connection conn) throws SQLException {
    try (Statement stmt = conn.createStatement()) {
      stmt.execute(
          """
          CREATE TABLE IF NOT EXISTS wallets (
              id       VARCHAR PRIMARY KEY,
              balance  BIGINT  NOT NULL CHECK(balance >= 0),
              currency VARCHAR NOT NULL
          )
          """);
      stmt.execute(
          """
          CREATE TABLE IF NOT EXISTS transfers (
              id                    VARCHAR PRIMARY KEY,
              source_wallet_id      VARCHAR NOT NULL,
              destination_wallet_id VARCHAR NOT NULL,
              amount                BIGINT  NOT NULL,
              currency              VARCHAR NOT NULL,
              reference             VARCHAR,
              status                VARCHAR NOT NULL,
              idempotency_key       VARCHAR UNIQUE,
              payload_hash          VARCHAR,
              created_at            VARCHAR NOT NULL
          )
          """);
      stmt.execute(
          """
          CREATE TABLE IF NOT EXISTS audit_events (
              id          VARCHAR PRIMARY KEY,
              transfer_id VARCHAR NOT NULL,
              event_type  VARCHAR NOT NULL,
              payload     VARCHAR,
              created_at  VARCHAR NOT NULL
          )
          """);
      stmt.execute(
          """
          CREATE TABLE IF NOT EXISTS outbox_events (
              id          VARCHAR PRIMARY KEY,
              transfer_id VARCHAR NOT NULL,
              event_type  VARCHAR NOT NULL,
              payload     VARCHAR,
              created_at  VARCHAR NOT NULL
          )
          """);
    }
  }
}
