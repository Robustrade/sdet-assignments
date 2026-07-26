package com.database.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import com.database.DatabaseManager;
import com.database.model.OutboxEventDBModel;

public class OutboxEventDao {

	public int countEventsForTransfer(String transferId) {
		return DatabaseManager.querySingleValue(
				"SELECT count(*) AS n FROM outbox_events WHERE aggregate_id = ?", transferId,
				rs -> rs.getInt("n"), 0);
	}

	/** Full outbox row for a transfer, so tests can assert the event content, not just its presence. */
	public OutboxEventDBModel getEventForTransfer(String transferId) {
		OutboxEventDBModel event = DatabaseManager.querySingleValue(
				"SELECT aggregate_type, aggregate_id, event_type, payload, published "
						+ "FROM outbox_events WHERE aggregate_id = ?",
				transferId,
				rs -> new OutboxEventDBModel(
						rs.getString("aggregate_type"),
						rs.getString("aggregate_id"),
						rs.getString("event_type"),
						rs.getString("payload"),
						rs.getBoolean("published")),
				null);
		if (event == null) {
			throw new IllegalStateException("No outbox event found for transfer " + transferId);
		}
		return event;
	}

	public int countAllEvents() {
		String sql = "SELECT count(*) AS n FROM outbox_events";
		try (Connection connection = DatabaseManager.getDataSource().getConnection();
				PreparedStatement statement = connection.prepareStatement(sql);
				ResultSet rs = statement.executeQuery()) {
			rs.next();
			return rs.getInt("n");
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to count outbox events", e);
		}
	}
}
