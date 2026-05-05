package com.kulu.sdet.util;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

public class DbUtil {

  private static final String DB_URL = "jdbc:postgresql://localhost:5432/wallet";
  private static final String DB_USER = "wallet";
  private static final String DB_PASSWORD = "wallet";

  public static Connection getConnection() {
    try {
      return DriverManager.getConnection(DB_URL, DB_USER, DB_PASSWORD);
    } catch (Exception e) {
      throw new RuntimeException("Failed to connect to database", e);
    }
  }

  public static int queryForInt(String sql, Object... params) {
    try (Connection conn = getConnection();
        PreparedStatement stmt = conn.prepareStatement(sql)) {
      for (int i = 0; i < params.length; i++) {
        stmt.setObject(i + 1, params[i]);
      }
      ResultSet rs = stmt.executeQuery();
      rs.next();
      return rs.getInt(1);
    } catch (Exception e) {
      throw new RuntimeException("DB query failed", e);
    }
  }

  public static void execute(String sql, Object... params) {
    try (Connection conn = getConnection();
        PreparedStatement stmt = conn.prepareStatement(sql)) {
      for (int i = 0; i < params.length; i++) {
        stmt.setObject(i + 1, params[i]);
      }
      stmt.executeUpdate();
    } catch (Exception e) {
      throw new RuntimeException("DB execute failed", e);
    }
  }
}
