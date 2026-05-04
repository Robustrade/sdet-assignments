package db;

import utils.ConfigReader;

import java.sql.*;

public class DbUtils {

    public static Connection conn() throws Exception {
        return DriverManager.getConnection(
                ConfigReader.get("db.url"),
                ConfigReader.get("db.user"),
                ConfigReader.get("db.password"));
    }

    public static int getBalance(String walletId) throws Exception {
        PreparedStatement ps = conn().prepareStatement(
                "SELECT balance FROM wallets WHERE id=?");
        ps.setString(1, walletId);

        ResultSet rs = ps.executeQuery();
        rs.next();
        return rs.getInt("balance");
    }

    public static int transferCount(String reference) throws Exception {
        PreparedStatement ps = conn().prepareStatement(
                "SELECT COUNT(*) FROM transfers WHERE reference=?");
        ps.setString(1, reference);

        ResultSet rs = ps.executeQuery();
        rs.next();
        return rs.getInt(1);
    }

    public static boolean idempotencyExists(String key) throws Exception {
        PreparedStatement ps = conn().prepareStatement(
                "SELECT COUNT(*) FROM idempotency_keys WHERE key=?");
        ps.setString(1, key);

        ResultSet rs = ps.executeQuery();
        rs.next();
        return rs.getInt(1) == 1;
    }

    public static boolean outboxEventExists(String reference) throws Exception {
        PreparedStatement ps = conn().prepareStatement(
                "SELECT COUNT(*) FROM outbox_events WHERE reference=?");
        ps.setString(1, reference);

        ResultSet rs = ps.executeQuery();
        rs.next();
        return rs.getInt(1) == 1;
    }

    public static int getTransferCountByKey(String key) throws Exception {

        PreparedStatement ps = conn().prepareStatement(
                "SELECT COUNT(*) FROM transfers WHERE idempotency_key=?"
        );
        ps.setString(1, key);

        ResultSet rs = ps.executeQuery();
        rs.next();
        return rs.getInt(1);
    }
    public static boolean auditExists(String reference) throws Exception {

        PreparedStatement ps = conn().prepareStatement(
                "SELECT COUNT(*) FROM transfer_events WHERE reference=?"
        );
        ps.setString(1, reference);

        ResultSet rs = ps.executeQuery();
        rs.next();
        return rs.getInt(1) == 1;
    }
}