package com.robustrade.wallet.dao;

import com.robustrade.wallet.model.TransferEvent;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public class TransferEventDao {

    public void insert(Connection conn, String transferId, String eventType, String details) throws SQLException {
        String sql = "INSERT INTO transfer_events (transfer_id, event_type, details, created_at) VALUES (?, ?, ?, ?)";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            ps.setString(2, eventType);
            ps.setString(3, details);
            ps.setTimestamp(4, Timestamp.from(Instant.now()));
            ps.executeUpdate();
        }
    }

    public List<TransferEvent> findByTransferId(Connection conn, String transferId) throws SQLException {
        String sql = "SELECT id, transfer_id, event_type, details, created_at FROM transfer_events WHERE transfer_id = ? ORDER BY id";
        List<TransferEvent> events = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, transferId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    events.add(new TransferEvent(
                            rs.getLong("id"),
                            rs.getString("transfer_id"),
                            rs.getString("event_type"),
                            rs.getString("details"),
                            Instant.ofEpochMilli(rs.getTimestamp("created_at").getTime())
                    ));
                }
            }
        }
        return events;
    }
}
