package com.wallet.fixture.service;

import com.wallet.fixture.model.WalletRecord;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;
import javax.sql.DataSource;

/** Read access to wallets, backing GET /wallets/{wallet_id}. */
public class WalletRepository {

	private final DataSource dataSource;

	public WalletRepository(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	public Optional<WalletRecord> findById(String walletId) {
		String sql = "SELECT wallet_id, currency, balance FROM wallets WHERE wallet_id = ?";
		try (Connection connection = dataSource.getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, walletId);
			try (ResultSet rs = statement.executeQuery()) {
				if (!rs.next()) {
					return Optional.empty();
				}
				return Optional.of(new WalletRecord(
						rs.getString("wallet_id"), rs.getString("currency"), rs.getLong("balance")));
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to load wallet " + walletId, e);
		}
	}
}
