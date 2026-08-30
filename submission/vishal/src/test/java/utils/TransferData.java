package utils;


import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public class TransferData {

	public static void transfer(long fromCustomerId, long toCustomerId, BigDecimal amount, String idempotencyKey)
			throws SQLException {

		String debitQuery = """
				update wallets
				set balance = balance - ?
				where customer_id = ?
				""";

		String creditQuery = """
				update wallets
				set balance = balance + ?
				where customer_id = ?
				""";

		String transferQuery = """
				insert into transfers
				(idempotency_key, from_wallet_id, to_wallet_id, amount, status)
				select ?,
				       (select wallet_id from wallets where customer_id = ?),
				       (select wallet_id from wallets where customer_id = ?),
				       ?,
				       'completed'
				""";

		try (Connection connection = DatabaseUtils.getConnection()) {

			connection.setAutoCommit(false);

			try (PreparedStatement debitStatement = connection.prepareStatement(debitQuery);
					PreparedStatement creditStatement = connection.prepareStatement(creditQuery);
					PreparedStatement transferStatement = connection.prepareStatement(transferQuery)) {

				debitStatement.setBigDecimal(1, amount);
				debitStatement.setLong(2, fromCustomerId);
				debitStatement.executeUpdate();

				creditStatement.setBigDecimal(1, amount);
				creditStatement.setLong(2, toCustomerId);
				creditStatement.executeUpdate();

				transferStatement.setString(1, idempotencyKey);
				transferStatement.setLong(2, fromCustomerId);
				transferStatement.setLong(3, toCustomerId);
				transferStatement.setBigDecimal(4, amount);
				transferStatement.executeUpdate();

				connection.commit();

				System.out.println("transfer completed successfully!");
			} catch (SQLException e) {
				connection.rollback();
				throw e;
			}
		}
	}
}
