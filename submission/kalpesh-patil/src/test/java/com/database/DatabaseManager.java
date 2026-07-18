package com.database;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import javax.sql.DataSource;

import com.api.utils.TestEnvironmentManager;

/**
 * Central JDBC access point for the DAO layer. Holds the shared DataSource and small query
 * helpers so individual DAOs stay focused on their own table.
 */
public class DatabaseManager {

	private static final DataSource DATA_SOURCE = TestEnvironmentManager.getInstance().getDataSource();

	private DatabaseManager() {
	}

	public static DataSource getDataSource() {
		return DATA_SOURCE;
	}

	/** Runs a single-value query with one string parameter and maps the first row, or returns defaultValue. */
	public static <T> T querySingleValue(String sql, String param, ResultSetMapper<T> mapper, T defaultValue) {
		try (Connection connection = DATA_SOURCE.getConnection();
				PreparedStatement statement = connection.prepareStatement(sql)) {
			statement.setString(1, param);
			try (ResultSet rs = statement.executeQuery()) {
				if (!rs.next()) {
					return defaultValue;
				}
				return mapper.map(rs);
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Query failed: " + sql, e);
		}
	}

	@FunctionalInterface
	public interface ResultSetMapper<T> {
		T map(ResultSet rs) throws SQLException;
	}
}
