package com.database.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.database.DatabaseManager;

public class WalletDao {

	private static final Logger LOGGER = LogManager.getLogger(WalletDao.class);

	/** Seeds a wallet directly against the schema -- seeding is Arrange, not the behavior under test. */
	public void seedWallet(String walletId, String currency, long balanceMinorUnits) {
		LOGGER.info("Seeding wallet {} with currency {} and balance {}", walletId, currency, balanceMinorUnits);
		String sql = "INSERT INTO wallets (wallet_id, currency, balance) VALUES (?, ?, ?)";
		try (Connection connection = DatabaseManager.getDataSource().getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, walletId);
			statement.setString(2, currency);
			statement.setLong(3, balanceMinorUnits);
			statement.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to seed wallet " + walletId, e);
		}
	}

	public long getBalance(String walletId) {
		Long balance = DatabaseManager.querySingleValue(
				"SELECT balance FROM wallets WHERE wallet_id = ?", walletId,
				rs -> rs.getLong("balance"), null);
		if (balance == null) {
			throw new IllegalStateException("No wallet seeded with id " + walletId);
		}
		return balance;
	}
}
