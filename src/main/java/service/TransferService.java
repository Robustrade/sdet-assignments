package service;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import utils.DatabaseUtils;

public class TransferService {

	public static void transfer(long fromWalletId, long toWalletId, BigDecimal amount, String idempotencyKey)
			throws SQLException {

		// Validate transfer amount

		if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
			throw new SQLException("Transfer amount must be greater than zero");
		}

		if (amount.scale() > 2) {
			throw new SQLException("Transfer amount cannot have more than 2 decimal places");
		}

		// Validate idempotency key

		if (idempotencyKey == null || idempotencyKey.isBlank()) {
			throw new SQLException("Idempotency key must not be null or blank");
		}

		// Validate source and destination

		if (fromWalletId == toWalletId) {
			throw new SQLException("Source and destination wallets cannot be the same");
		}

		try (Connection connection = DatabaseUtils.getConnection()) {

			connection.setAutoCommit(false);

			try {

				// Check whether this idempotency key was already processed
				String checkSql = "select transfer_id " + "from transfers " + "where idempotency_key = ?";

				try (PreparedStatement statement = connection.prepareStatement(checkSql)) {

					statement.setString(1, idempotencyKey);

					try (ResultSet resultSet = statement.executeQuery()) {

						if (resultSet.next()) {

							System.out.println("Duplicate transfer detected. Transfer ignored.");

							connection.rollback();
							return;
						}
					}
				}

				// Check source wallet balance
				String balanceSql = "select balance " + "from wallets " + "where wallet_id = ?";

				try (PreparedStatement statement = connection.prepareStatement(balanceSql)) {

					statement.setLong(1, fromWalletId);

					try (ResultSet resultSet = statement.executeQuery()) {

						if (!resultSet.next()) {

							throw new SQLException("Source wallet not found: " + fromWalletId);
						}

						BigDecimal currentBalance = resultSet.getBigDecimal("balance");

						if (currentBalance.compareTo(amount) < 0) {

							throw new SQLException("Insufficient balance in wallet: " + fromWalletId);
						}
					}
				}

				// Debit source wallet
				// Debit source wallet

				String debitSql = "update wallets " + "set balance = balance - ? " + "where wallet_id = ? "
						+ "and balance >= ?";

				try (PreparedStatement statement = connection.prepareStatement(debitSql)) {

					statement.setBigDecimal(1, amount);
					statement.setLong(2, fromWalletId);
					statement.setBigDecimal(3, amount);

					int rowsUpdated = statement.executeUpdate();

					if (rowsUpdated == 0) {
						throw new SQLException("Insufficient balance");
					}
				}

				// Credit destination wallet
				String creditSql = "update wallets " + "set balance = balance + ? " + "where wallet_id = ?";

				try (PreparedStatement statement = connection.prepareStatement(creditSql)) {

					statement.setBigDecimal(1, amount);
					statement.setLong(2, toWalletId);

					int rowsUpdated = statement.executeUpdate();

					if (rowsUpdated == 0) {

						throw new SQLException("Destination wallet not found: " + toWalletId);
					}
				}

				// Record transfer
				String insertSql = "insert into transfers "
						+ "(idempotency_key, from_wallet_id, to_wallet_id, amount, status) " + "values (?, ?, ?, ?, ?)";

				try (PreparedStatement statement = connection.prepareStatement(insertSql)) {

					statement.setString(1, idempotencyKey);
					statement.setLong(2, fromWalletId);
					statement.setLong(3, toWalletId);
					statement.setBigDecimal(4, amount);
					statement.setString(5, "completed");

					statement.executeUpdate();
				}

				connection.commit();

				System.out.println("Transfer completed successfully!");

			} catch (SQLException e) {

				connection.rollback();

				if ("23505".equals(e.getSQLState())) {

					System.out.println("Duplicate transfer detected during concurrent processing. Transfer ignored.");

					return;
				}

				throw e;

			} catch (Exception e) {

				connection.rollback();

				throw e;
			}
		}
	}
}
