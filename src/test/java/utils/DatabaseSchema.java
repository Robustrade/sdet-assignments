package utils;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

public class DatabaseSchema {

	public static void createTables() throws SQLException {

		try (Connection connection = DatabaseUtils.getConnection();
				Statement statement = connection.createStatement()) {

			statement.execute("""
					create table if not exists wallets (
					    wallet_id bigserial primary key,
					    customer_id bigint not null unique,
					    balance numeric(19,2) not null default 0,
					    created_at timestamp default current_timestamp
					)
					""");

			statement.execute("""
					create table if not exists transfers (
					    transfer_id bigserial primary key,
					    idempotency_key varchar(100) not null unique,
					    from_wallet_id bigint not null,
					    to_wallet_id bigint not null,
					    amount numeric(19,2) not null,
					    status varchar(20) not null,
					    created_at timestamp default current_timestamp
					)
					""");

			System.out.println("database tables created successfully!");
		}
	}

	public static void insertTestWallets() throws SQLException {

		try (Connection connection = DatabaseUtils.getConnection();
				Statement statement = connection.createStatement()) {

			statement.execute("""
					insert into wallets (customer_id, balance)
					values
					    (1001, 1000.00),
					    (1002, 500.00)
					on conflict (customer_id)
					do update set balance = excluded.balance
					""");

			System.out.println("test wallets created successfully!");
			System.out.println("Wallet test data inserted successfully!");
		}
	}

	public static void resetTestData() throws SQLException {

	    try (Connection connection = DatabaseUtils.getConnection();
	            Statement statement = connection.createStatement()) {

	        // Remove previous transfer records
	        statement.executeUpdate("delete from transfers");

	        // Reset wallet balances using wallet_id
	        statement.executeUpdate("""
	                update wallets
	                set balance = case
	                    when wallet_id = 1001 then 1000.00
	                    when wallet_id = 1002 then 500.00
	                    else balance
	                end
	                """);

	        System.out.println("Test database reset successfully!");
	    }
	}

	public static void resetDatabase() throws SQLException {

		String query = """
				DROP TABLE IF EXISTS transfers;
				DROP TABLE IF EXISTS wallets;
				""";

		try (Connection connection = DatabaseUtils.getConnection();
				Statement statement = connection.createStatement()) {

			statement.execute(query);

			System.out.println("Test database reset successfully!");
		}
	}
}
