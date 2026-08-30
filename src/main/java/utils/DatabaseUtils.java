package utils;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.TimeZone;

public class DatabaseUtils {

	private static String jdbcUrl;
	private static String username;
	private static String password;

	public static void configureDatabase(String jdbcUrl, String username, String password) {

		DatabaseUtils.jdbcUrl = jdbcUrl;
		DatabaseUtils.username = username;
		DatabaseUtils.password = password;
	}

	public static Connection getConnection() throws SQLException {

		TimeZone.setDefault(TimeZone.getTimeZone("Asia/Kolkata"));

		return DriverManager.getConnection(jdbcUrl, username, password);
	}

	public static BigDecimal getWalletBalance(long walletId) throws SQLException {

	    String query = """
	            select balance
	            from wallets
	            where wallet_id = ?
	            """;

	    try (Connection connection = getConnection();
	            PreparedStatement statement = connection.prepareStatement(query)) {

	        statement.setLong(1, walletId);

	        try (ResultSet resultSet = statement.executeQuery()) {

	            if (resultSet.next()) {
	                return resultSet.getBigDecimal("balance");
	            }

	            throw new SQLException("Wallet not found: " + walletId);
	        }
	    }
	}


	public static int getTransferCount(String idempotencyKey) throws SQLException {

		String query = """
				select count(*)
				from transfers
				where idempotency_key = ?
				""";

		try (Connection connection = getConnection();
				PreparedStatement statement = connection.prepareStatement(query)) {

			statement.setString(1, idempotencyKey);

			try (ResultSet resultSet = statement.executeQuery()) {

				if (resultSet.next()) {
					return resultSet.getInt(1);
				}

				return 0;
			}
		}
	}

	public static String getTransferStatus(String idempotencyKey) throws SQLException {

		String query = """
				select status
				from transfers
				where idempotency_key = ?
				""";

		try (Connection connection = getConnection();
				PreparedStatement statement = connection.prepareStatement(query)) {

			statement.setString(1, idempotencyKey);

			try (ResultSet resultSet = statement.executeQuery()) {

				if (resultSet.next()) {
					return resultSet.getString("status");
				}

				throw new SQLException("Transfer not found for idempotency key: " + idempotencyKey);
			}
		}
	}

	public static Object[] getTransferDetails(String idempotencyKey) throws SQLException {

		String query = """
				select idempotency_key,
				       from_wallet_id,
				       to_wallet_id,
				       amount,
				       status
				from transfers
				where idempotency_key = ?
				""";

		try (Connection connection = getConnection();
				PreparedStatement statement = connection.prepareStatement(query)) {

			statement.setString(1, idempotencyKey);

			try (ResultSet resultSet = statement.executeQuery()) {

				if (resultSet.next()) {

					return new Object[] { resultSet.getString("idempotency_key"), resultSet.getLong("from_wallet_id"),
							resultSet.getLong("to_wallet_id"), resultSet.getBigDecimal("amount"),
							resultSet.getString("status") };
				}

				throw new SQLException("Transfer not found for idempotency key: " + idempotencyKey);
			}
		}
	}
	public static void resetDatabase() throws SQLException {

	    String deleteTransfers = "DELETE FROM transfers";

	    String resetWallets = """
	            UPDATE wallets
	            SET balance = CASE
	                WHEN wallet_id = 1001 THEN 1000.00
	                WHEN wallet_id = 1002 THEN 500.00
	            END
	            WHERE wallet_id IN (1001, 1002)
	            """;

	    try (Connection connection = getConnection();
	            PreparedStatement deleteStatement = connection.prepareStatement(deleteTransfers);
	            PreparedStatement walletStatement = connection.prepareStatement(resetWallets)) {

	        deleteStatement.executeUpdate();
	        walletStatement.executeUpdate();
	    }
	}
}
