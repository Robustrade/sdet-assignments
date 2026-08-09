package com.robustrade.wallet.dao;

import com.robustrade.wallet.model.OutboxEvent;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public class OutboxEventDao {

    public void insert(Connection conn, String transferId, String eventType, String payload, String status) throws SQLException {
        String sql = "INSERT INTO outbox_events (transfer_id, event_type, payload, status, created_at) VALUES (?, ?, ?, ?, ?)";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            ps.setString(2, eventType);
            ps.setString(3, payload);
            ps.setString(4, status);
            ps.setTimestamp(5, Timestamp.from(Instant.now()));
            ps.executeUpdate();
        }
    }

    public List<OutboxEvent> findByTransferId(Connection conn, String transferId) throws SQLException {
        String sql = "SELECT id, transfer_id, event_type, payload, status, created_at FROM outbox_events WHERE transfer_id = ? ORDER BY id";
        List<OutboxEvent> events = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    events.add(new OutboxEvent(
                            rs.getLong("id"),
                            rs.getString("transfer_id"),
                            rs.getString("event_type"),
                            rs.getString("payload"),
                            rs.getString("status"),
                            Instant.ofEpochMilli(rs.getTimestamp("created_at").getTime())
                    ));
                }
            }
        }
        return events;
    }
}
