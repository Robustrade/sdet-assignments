package com.kulu.wallet.db;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

public final class Database {
  private final String jdbcUrl;

  public Database(String jdbcUrl) {
    this.jdbcUrl = jdbcUrl;
  }

  public static Database inMemory() {
    return new Database(
        "jdbc:h2:mem:wallet_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
  }

  public Connection getConnection() throws SQLException {
    return DriverManager.getConnection(jdbcUrl, "sa", "");
  }

  public void migrate() {
    String schema = readClasspathResource("schema.sql");
    try (Connection connection = getConnection();
        Statement statement = connection.createStatement()) {
      for (String raw : schema.split(";")) {
        String sql = raw.trim();
        if (!sql.isEmpty()) {
          statement.execute(sql);
        }
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to apply schema", e);
    }
  }

  private static String readClasspathResource(String name) {
    try (InputStream in = Database.class.getClassLoader().getResourceAsStream(name)) {
      if (in == null) {
        throw new IllegalStateException("Missing classpath resource: " + name);
      }
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new IllegalStateException("Unable to read resource: " + name, e);
    }
  }
}
