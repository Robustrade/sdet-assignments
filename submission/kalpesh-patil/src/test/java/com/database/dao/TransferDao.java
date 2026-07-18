package com.database.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import com.database.DatabaseManager;

public class TransferDao {

	public int countTransfersBetween(String sourceWalletId, String destinationWalletId) {
		String sql = "SELECT count(*) AS n FROM transfers WHERE source_wallet_id = ? AND destination_wallet_id = ?";
		try (Connection connection = DatabaseManager.getDataSource().getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, sourceWalletId);
			statement.setString(2, destinationWalletId);
			try (ResultSet rs = statement.executeQuery()) {
				rs.next();
				return rs.getInt("n");
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to count transfers", e);
		}
	}

	public int countAllTransfers() {
		String sql = "SELECT count(*) AS n FROM transfers";
		try (Connection connection = DatabaseManager.getDataSource().getConnection();
				PreparedStatement statement = connection.prepareStatement(sql);
				ResultSet rs = statement.executeQuery()) {
			rs.next();
			return rs.getInt("n");
		} catch (SQLException e) {
			throw new IllegalStateException("Failed to count transfers", e);
		}
	}
}
