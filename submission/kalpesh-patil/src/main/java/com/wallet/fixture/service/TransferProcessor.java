package com.wallet.fixture.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wallet.fixture.model.TransferRecord;
import com.wallet.fixture.model.TransferRequest;
import com.wallet.fixture.model.TransferResult;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.sql.DataSource;

/**
 * Core transfer processing. Both wallet rows are locked in one SELECT ... FOR UPDATE ordered by
 * wallet_id so opposing transfers (A->B and B->A) always lock in the same order and cannot
 * deadlock. Validation runs before the idempotency key is reserved, so every reservation ends in
 * a persisted transfer row that a replay can read back.
 */
public class TransferProcessor {

	private static final Pattern CURRENCY_PATTERN = Pattern.compile("^[A-Z]{3}$");
	private static final ObjectMapper OUTBOX_PAYLOAD_MAPPER = new ObjectMapper();

	private final DataSource dataSource;
	private final IdempotencyStore idempotencyStore;

	public TransferProcessor(DataSource dataSource) {
		this.dataSource = dataSource;
		this.idempotencyStore = new IdempotencyStore(dataSource);
	}

	public TransferResult process(TransferRequest request, String idempotencyKey) {
		if (isBlank(idempotencyKey)) {
			throw new ValidationException("Idempotency-Key header is required");
		}
		validateStructure(request);
		checkWalletsExistAndCurrencyMatches(request);

		String requestHash = RequestHasher.hash(request);
		IdempotencyStore.Reservation reservation = idempotencyStore.reserve(idempotencyKey, requestHash);

		return switch (reservation.outcome()) {
			case CONFLICT -> throw new IdempotencyConflictException(idempotencyKey);
			case REPLAY -> replay(reservation, idempotencyKey);
			case RESERVED -> processReserved(request, idempotencyKey);
		};
	}

	private TransferResult replay(IdempotencyStore.Reservation reservation, String idempotencyKey) {
		IdempotencyStore.Existing existing = reservation.existing()
				.orElseThrow(() -> new IllegalStateException(
						"REPLAY outcome missing existing record for key " + idempotencyKey));
		TransferRecord record = findTransfer(existing.transferId())
				.orElseThrow(() -> new IllegalStateException(
						"Idempotency key references missing transfer " + existing.transferId()));
		return TransferResult.persisted(existing.responseStatus(), record, true);
	}

	private void validateStructure(TransferRequest request) {
		if (isBlank(request.sourceWalletId()) || isBlank(request.destinationWalletId())) {
			throw new ValidationException("source_wallet_id and destination_wallet_id are required");
		}
		if (request.sourceWalletId().equals(request.destinationWalletId())) {
			throw new ValidationException("source_wallet_id and destination_wallet_id must differ");
		}
		if (request.amount() <= 0) {
			throw new ValidationException("amount must be a positive integer");
		}
		if (isBlank(request.currency()) || !CURRENCY_PATTERN.matcher(request.currency()).matches()) {
			throw new ValidationException("currency must be a 3-letter uppercase ISO 4217 code");
		}
	}

	private void checkWalletsExistAndCurrencyMatches(TransferRequest request) {
		try (Connection connection = dataSource.getConnection()) {
			Map<String, WalletRow> wallets = fetchWallets(connection, request.sourceWalletId(),
					request.destinationWalletId(), false);
			requireWallet(wallets, request.sourceWalletId());
			requireWallet(wallets, request.destinationWalletId());

			for (WalletRow wallet : wallets.values()) {
				if (!wallet.currency().equals(request.currency())) {
					throw new ValidationException("currency '" + request.currency() + "' does not match wallet '"
							+ wallet.walletId() + "' currency '" + wallet.currency() + "'");
				}
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to check wallet existence", e);
		}
	}

	private void requireWallet(Map<String, WalletRow> wallets, String walletId) {
		if (!wallets.containsKey(walletId)) {
			throw new WalletNotFoundException(walletId);
		}
	}

	private TransferResult processReserved(TransferRequest request, String idempotencyKey) {
		try (Connection connection = dataSource.getConnection()) {
			connection.setAutoCommit(false);
			try {
				Map<String, WalletRow> locked = fetchWallets(connection, request.sourceWalletId(),
						request.destinationWalletId(), true);
				WalletRow source = locked.get(request.sourceWalletId());
				WalletRow destination = locked.get(request.destinationWalletId());

				String transferId = UUID.randomUUID().toString();
				TransferResult result;
				if (source.balance() < request.amount()) {
					insertTransfer(connection, transferId, request, "FAILED", "INSUFFICIENT_FUNDS");
					insertEvent(connection, transferId, "TRANSFER_REQUESTED", null);
					insertEvent(connection, transferId, "TRANSFER_FAILED", "INSUFFICIENT_FUNDS");
					connection.commit();
					result = TransferResult.persisted(422, findTransfer(transferId).orElseThrow(), false);
				} else {
					debit(connection, source.walletId(), request.amount());
					credit(connection, destination.walletId(), request.amount());
					insertTransfer(connection, transferId, request, "COMPLETED", null);
					insertEvent(connection, transferId, "TRANSFER_REQUESTED", null);
					insertEvent(connection, transferId, "TRANSFER_COMPLETED", null);
					insertOutboxEvent(connection, transferId, request);
					connection.commit();
					result = TransferResult.persisted(201, findTransfer(transferId).orElseThrow(), false);
				}
				idempotencyStore.complete(idempotencyKey, transferId, result.httpStatus());
				return result;
			} catch (RuntimeException | SQLException e) {
				connection.rollback();
				throw e instanceof RuntimeException re ? re : new IllegalStateException(e);
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to process transfer", e);
		}
	}

	private Map<String, WalletRow> fetchWallets(Connection connection, String walletId1, String walletId2,
			boolean forUpdate) throws SQLException {
		// single statement, ORDER BY wallet_id: any two transfers touching the same wallet
		// pair acquire row locks in the same order, whichever wallet each calls "source"
		String sql = "SELECT wallet_id, currency, balance FROM wallets WHERE wallet_id IN (?, ?) ORDER BY wallet_id"
				+ (forUpdate ? " FOR UPDATE" : "");
		try (PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, walletId1);
			statement.setString(2, walletId2);
			try (ResultSet rs = statement.executeQuery()) {
				Map<String, WalletRow> result = new LinkedHashMap<>();
				while (rs.next()) {
					WalletRow row = new WalletRow(rs.getString("wallet_id"), rs.getString("currency"),
							rs.getLong("balance"));
					result.put(row.walletId(), row);
				}
				return result;
			}
		}
	}

	private void debit(Connection connection, String walletId, long amount) throws SQLException {
		adjustBalance(connection, walletId, -amount);
	}

	private void credit(Connection connection, String walletId, long amount) throws SQLException {
		adjustBalance(connection, walletId, amount);
	}

	private void adjustBalance(Connection connection, String walletId, long delta) throws SQLException {
		String sql = "UPDATE wallets SET balance = balance + ?, updated_at = now() WHERE wallet_id = ?";
		try (PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setLong(1, delta);
			statement.setString(2, walletId);
			statement.executeUpdate();
		}
	}

	private void insertTransfer(Connection connection, String transferId, TransferRequest request, String status,
			String failureReason) throws SQLException {
		String sql = "INSERT INTO transfers (transfer_id, source_wallet_id, destination_wallet_id, amount, "
				+ "currency, reference, status, failure_reason, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())";
		try (PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setObject(1, UUID.fromString(transferId));
			statement.setString(2, request.sourceWalletId());
			statement.setString(3, request.destinationWalletId());
			statement.setLong(4, request.amount());
			statement.setString(5, request.currency());
			statement.setString(6, request.reference());
			statement.setString(7, status);
			statement.setString(8, failureReason);
			statement.executeUpdate();
		}
	}

	private void insertEvent(Connection connection, String transferId, String eventType, String details)
			throws SQLException {
		String sql = "INSERT INTO transfer_events (transfer_id, event_type, details) VALUES (?, ?, ?)";
		try (PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setObject(1, UUID.fromString(transferId));
			statement.setString(2, eventType);
			statement.setString(3, details);
			statement.executeUpdate();
		}
	}

	private void insertOutboxEvent(Connection connection, String transferId, TransferRequest request)
			throws SQLException {
		Map<String, Object> payloadFields = new LinkedHashMap<>();
		payloadFields.put("transfer_id", transferId);
		payloadFields.put("source_wallet_id", request.sourceWalletId());
		payloadFields.put("destination_wallet_id", request.destinationWalletId());
		payloadFields.put("amount", request.amount());
		payloadFields.put("currency", request.currency());
		String payload;
		try {
			payload = OUTBOX_PAYLOAD_MAPPER.writeValueAsString(payloadFields);
		} catch (JsonProcessingException e) {
			throw new IllegalStateException("Failed to serialize outbox payload", e);
		}
		String sql = "INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload) "
				+ "VALUES ('TRANSFER', ?, 'TRANSFER_COMPLETED', ?)";
		try (PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, transferId);
			statement.setString(2, payload);
			statement.executeUpdate();
		}
	}

	public Optional<TransferRecord> findTransfer(String transferId) {
		String sql = "SELECT transfer_id, source_wallet_id, destination_wallet_id, amount, currency, "
				+ "reference, status, failure_reason, created_at, completed_at FROM transfers WHERE transfer_id = ?";
		try (Connection connection = dataSource.getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setObject(1, UUID.fromString(transferId));
			try (ResultSet rs = statement.executeQuery()) {
				if (!rs.next()) {
					return Optional.empty();
				}
				Timestamp completedAt = rs.getTimestamp("completed_at");
				return Optional.of(new TransferRecord(
						rs.getObject("transfer_id", UUID.class).toString(),
						rs.getString("source_wallet_id"),
						rs.getString("destination_wallet_id"),
						rs.getLong("amount"),
						rs.getString("currency"),
						rs.getString("reference"),
						rs.getString("status"),
						rs.getString("failure_reason"),
						rs.getTimestamp("created_at").toInstant(),
						completedAt != null ? completedAt.toInstant() : null));
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to load transfer " + transferId, e);
		}
	}

	private static boolean isBlank(String value) {
		return value == null || value.isBlank();
	}
}
