package com.kulu.wallet.db;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public class EventRepository {

  public void insertTransferEvent(
      Connection connection, String transferId, String eventType, String details)
      throws SQLException {
    String sql = "INSERT INTO transfer_events (transfer_id, event_type, details) VALUES (?, ?, ?)";
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, transferId);
      ps.setString(2, eventType);
      ps.setString(3, details);
      ps.executeUpdate();
    }
  }

  public void insertOutboxEvent(
      Connection connection, String aggregateId, String eventType, String payload)
      throws SQLException {
    String sql = "INSERT INTO outbox_events (aggregate_id, event_type, payload) VALUES (?, ?, ?)";
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, aggregateId);
      ps.setString(2, eventType);
      ps.setString(3, payload);
      ps.executeUpdate();
    }
  }

  public long countTransferEvents(Connection connection, String transferId) throws SQLException {
    String sql = "SELECT COUNT(*) FROM transfer_events WHERE transfer_id = ?";
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, transferId);
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        return rs.getLong(1);
      }
    }
  }

  public List<String> listTransferEventTypes(Connection connection, String transferId)
      throws SQLException {
    String sql = "SELECT event_type FROM transfer_events WHERE transfer_id = ? ORDER BY id";
    List<String> types = new ArrayList<>();
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, transferId);
      try (ResultSet rs = ps.executeQuery()) {
        while (rs.next()) {
          types.add(rs.getString(1));
        }
      }
    }
    return types;
  }

  public long countOutboxForAggregate(Connection connection, String aggregateId, String eventType)
      throws SQLException {
    String sql = "SELECT COUNT(*) FROM outbox_events WHERE aggregate_id = ? AND event_type = ?";
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
      ps.setString(1, aggregateId);
      ps.setString(2, eventType);
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        return rs.getLong(1);
      }
    }
  }

  public long countAllOutbox(Connection connection) throws SQLException {
    try (PreparedStatement ps = connection.prepareStatement("SELECT COUNT(*) FROM outbox_events");
        ResultSet rs = ps.executeQuery()) {
      rs.next();
      return rs.getLong(1);
    }
  }
}
