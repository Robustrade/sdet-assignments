package com.wallet.fixture.service;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;

/**
 * Insert-first idempotency handling: the key is inserted before any processing, so the primary
 * key constraint decides concurrent duplicates -- at most one INSERT wins, everyone else reads
 * the winner's row.
 */
class IdempotencyStore {

	private static final Duration POLL_TIMEOUT = Duration.ofSeconds(5);
	private static final Duration POLL_INTERVAL = Duration.ofMillis(25);

	private final DataSource dataSource;

	IdempotencyStore(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	enum Outcome {
		RESERVED, REPLAY, CONFLICT
	}

	record Reservation(Outcome outcome, Optional<Existing> existing) {}

	record Existing(String transferId, int responseStatus) {}

	/**
	 * Tries to become the owner of processing for this key. If another request already owns it,
	 * waits (bounded) for it to finish, then classifies the result as replay or conflict.
	 */
	Reservation reserve(String idempotencyKey, String requestHash) {
		if (tryInsertReservation(idempotencyKey, requestHash)) {
			return new Reservation(Outcome.RESERVED, Optional.empty());
		}
		return awaitExistingReservation(idempotencyKey, requestHash);
	}

	private boolean tryInsertReservation(String idempotencyKey, String requestHash) {
		String sql = "INSERT INTO idempotency_keys (idempotency_key, request_hash, state) "
				+ "VALUES (?, ?, 'IN_PROGRESS') ON CONFLICT (idempotency_key) DO NOTHING";
		try (Connection connection = dataSource.getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, idempotencyKey);
			statement.setString(2, requestHash);
			return statement.executeUpdate() == 1;
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to reserve idempotency key", e);
		}
	}

	private Reservation awaitExistingReservation(String idempotencyKey, String requestHash) {
		Instant deadline = Instant.now().plus(POLL_TIMEOUT);
		while (true) {
			ExistingRow row = readRow(idempotencyKey);
			if (row == null) {
				// rows are never deleted, so this is effectively unreachable; retry the insert
				// once defensively rather than throwing
				if (tryInsertReservation(idempotencyKey, requestHash)) {
					return new Reservation(Outcome.RESERVED, Optional.empty());
				}
				continue;
			}
			if (!row.requestHash.equals(requestHash)) {
				return new Reservation(Outcome.CONFLICT, Optional.empty());
			}
			if ("COMPLETED".equals(row.state)) {
				return new Reservation(Outcome.REPLAY,
						Optional.of(new Existing(row.transferId, row.responseStatus)));
			}
			if (Instant.now().isAfter(deadline)) {
				throw new IllegalStateException("Timed out waiting for concurrent request with idempotency key '"
						+ idempotencyKey + "' to finish processing");
			}
			sleep(POLL_INTERVAL);
		}
	}

	/** Marks a reservation COMPLETED with the processing outcome. Called after the business transaction commits. */
	void complete(String idempotencyKey, String transferId, int responseStatus) {
		String sql = "UPDATE idempotency_keys SET state = 'COMPLETED', transfer_id = ?, response_status = ? "
				+ "WHERE idempotency_key = ?";
		try (Connection connection = dataSource.getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setObject(1, transferId != null ? UUID.fromString(transferId) : null);
			statement.setInt(2, responseStatus);
			statement.setString(3, idempotencyKey);
			statement.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to complete idempotency reservation", e);
		}
	}

	private ExistingRow readRow(String idempotencyKey) {
		String sql = "SELECT request_hash, state, transfer_id, response_status FROM idempotency_keys "
				+ "WHERE idempotency_key = ?";
		try (Connection connection = dataSource.getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, idempotencyKey);
			try (ResultSet rs = statement.executeQuery()) {
				if (!rs.next()) {
					return null;
				}
				Object transferIdObj = rs.getObject("transfer_id");
				return new ExistingRow(
						rs.getString("request_hash"),
						rs.getString("state"),
						transferIdObj != null ? transferIdObj.toString() : null,
						rs.getInt("response_status"));
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to read idempotency key row", e);
		}
	}

	private static void sleep(Duration duration) {
		try {
			Thread.sleep(duration.toMillis());
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			throw new IllegalStateException("Interrupted while awaiting idempotency reservation", e);
		}
	}

	private record ExistingRow(String requestHash, String state, String transferId, int responseStatus) {}
}
