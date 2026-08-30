package utils;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public class TestData {

    public static void createWallets() throws SQLException {

        String query = """
                insert into wallets (wallet_id, customer_id, balance)
                values (?, ?, ?)
                """;

        try (Connection connection = DatabaseUtils.getConnection();
                PreparedStatement statement = connection.prepareStatement(query)) {

            // Wallet 1001
            statement.setLong(1, 1001);
            statement.setLong(2, 1001);
            statement.setBigDecimal(3, new BigDecimal("1000.00"));
            statement.executeUpdate();

            // Wallet 1002
            statement.setLong(1, 1002);
            statement.setLong(2, 1002);
            statement.setBigDecimal(3, new BigDecimal("500.00"));
            statement.executeUpdate();

            System.out.println("test wallets created successfully!");
        }
    }
}
