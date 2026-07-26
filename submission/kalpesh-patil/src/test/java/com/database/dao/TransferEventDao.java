package com.database.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.database.DatabaseManager;

public class TransferEventDao {

	/** Event types for a transfer, in the order they were recorded. */
	public List<String> getEventTypes(String transferId) {
		String sql = "SELECT event_type FROM transfer_events WHERE transfer_id = ? ORDER BY event_id";
		try (Connection connection = DatabaseManager.getDataSource().getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setObject(1, UUID.fromString(transferId));
			try (ResultSet rs = statement.executeQuery()) {
				List<String> types = new ArrayList<>();
				while (rs.next()) {
					types.add(rs.getString("event_type"));
				}
				return types;
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to load transfer events", e);
		}
	}
}
