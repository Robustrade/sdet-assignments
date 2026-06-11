package com.kulu.sdet;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.Context;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.*;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public final class WalletTransferAppStarts {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final String jdbcUrl;
    private final String dbUser;
    private final String dbPass;
    private Javalin app;

    public WalletTransferAppStarts() {
        this(pick("wallet.db.url", "WALLET_DB_URL", "DB_URL", "jdbc:postgresql://localhost:5432/walletdb"), pick("wallet.db.user", "WALLET_DB_USER", "DB_USER", "sdet"), pick("wallet.db.pass", "WALLET_DB_PASS", "DB_PASS", "sdet_pass"));
    }

    public WalletTransferAppStarts(String jdbcUrl, String dbUser, String dbPass) {
        this.jdbcUrl = jdbcUrl;
        this.dbUser = dbUser;
        this.dbPass = dbPass;
    }

    public static void main(String[] args) {
        new WalletTransferAppStarts().start();
    }

    private static String asText(Object value) {
        if (value == null) {
            return null;
        }
        String v = String.valueOf(value).trim();
        return v.isEmpty() ? null : v;
    }

    private static boolean nonBlank(String v) {
        return v != null && !v.isBlank();
    }

    private static String pick(String sysProp, String envVar1, String envVar2, String fallback) {
        String fromProp = System.getProperty(sysProp);
        if (nonBlank(fromProp)) {
            return fromProp;
        }
        String env1 = System.getenv(envVar1);
        if (nonBlank(env1)) {
            return env1;
        }
        String env2 = System.getenv(envVar2);
        if (nonBlank(env2)) {
            return env2;
        }
        return fallback;
    }

    public Javalin start() {
        return start("localhost", 8080);
    }

    public Javalin start(String host, int port) {
        app = Javalin.create(cfg -> cfg.showJavalinBanner = false);
        registerRoutes(app);
        app.start(host, port);
        return app;
    }

    public void stop() {
        if (app != null) {
            app.stop();
            app = null;
        }
    }

    private void registerRoutes(Javalin javalin) {
        javalin.post("/v1/wallets/transfer", this::handleTransfer);
        javalin.post("/v1/wallets/transferValidate", this::handleTransfer);
        javalin.get("/v1/wallets/{id}", this::handleGetWallet);
        javalin.get("/v1/wallets/transfer/{id}", this::handleGetTransfer);
    }

    private void handleTransfer(Context ctx) {
        Map<String, Object> body;
        try {
            body = MAPPER.readValue(ctx.body(), new TypeReference<>() {
            });
        } catch (Exception e) {
            writeError(ctx, 400, "invalid json body");
            return;
        }

        String fromWalletId = asText(body.get("fromWalletId"));
        String toWalletId = asText(body.get("toWalletId"));
        String currency = asText(body.get("currency"));
        BigDecimal amount = parseAmount(body.get("amount"));
        String keyFromHeader = ctx.header("Idempotency-Key");
        String keyFromBody = asText(body.get("idempotencyKey"));
        String idempotencyKey = nonBlank(keyFromHeader) ? keyFromHeader : keyFromBody;

        String validationError = validateTransfer(fromWalletId, toWalletId, currency, amount);
        if (validationError != null) {
            writeError(ctx, 400, validationError);
            return;
        }

        String requestHash = hashPayload(fromWalletId, toWalletId, amount, currency);

        try (Connection con = openConnection()) {
            con.setAutoCommit(false);

            if (nonBlank(idempotencyKey)) {
                ensureIdempotencyRow(con, idempotencyKey, requestHash);
                IdempotencyState state = lockIdempotencyRow(con, idempotencyKey);
                if (!requestHash.equals(state.requestHash())) {
                    con.rollback();
                    writeError(ctx, 409, "idempotency key already used with different payload");
                    return;
                }
                if (state.statusCode() != null && state.responseBody() != null) {
                    con.commit();
                    ctx.status(state.statusCode());
                    ctx.contentType("application/json");
                    ctx.result(state.responseBody());
                    return;
                }
            }

            WalletRow from = null;
            WalletRow to = null;
            String firstLock = fromWalletId.compareTo(toWalletId) <= 0 ? fromWalletId : toWalletId;
            String secondLock = fromWalletId.compareTo(toWalletId) <= 0 ? toWalletId : fromWalletId;

            WalletRow first = lockWallet(con, firstLock);
            WalletRow second = lockWallet(con, secondLock);

            if (first == null || second == null) {
                con.rollback();
                writeError(ctx, 404, "wallet not found");
                return;
            }

            if (fromWalletId.equals(first.id())) {
                from = first;
                to = second;
            } else {
                from = second;
                to = first;
            }

            if (from.balance().compareTo(amount) < 0) {
                String failureId = UUID.randomUUID().toString();
                insertAudit(con, failureId, "TRANSFER_REJECTED", "TRANSFER", failureId, "insufficient balance for transfer");
                if (nonBlank(idempotencyKey)) {
                    String body422 = toJson(Map.of("error", "insufficient balance"));
                    persistIdempotentResult(con, idempotencyKey, requestHash, 422, null, body422);
                }
                con.commit();
                writeError(ctx, 422, "insufficient balance");
                return;
            }

            String txId = UUID.randomUUID().toString();

            executeUpdate(con, "INSERT INTO transactions (id, from_wallet_id, to_wallet_id, amount, currency, status) " + "VALUES (?, ?, ?, ?, ?, 'COMPLETED')", txId, fromWalletId, toWalletId, amount, currency.toUpperCase());

            executeUpdate(con, "UPDATE wallets SET balance = balance - ? WHERE id = ?", amount, fromWalletId);
            executeUpdate(con, "UPDATE wallets SET balance = balance + ? WHERE id = ?", amount, toWalletId);

            insertAudit(con, UUID.randomUUID().toString(), "TRANSFER_COMPLETED", "TRANSFER", txId, "wallet transfer completed");

            Map<String, Object> event = new LinkedHashMap<>();
            event.put("transactionId", txId);
            event.put("fromWalletId", fromWalletId);
            event.put("toWalletId", toWalletId);
            event.put("amount", amount.toPlainString());
            event.put("currency", currency.toUpperCase());

            executeUpdate(con, "INSERT INTO outbox_events (id, event_type, aggregate_id, payload) VALUES (?, ?, ?, ?)", UUID.randomUUID().toString(), "TRANSFER_COMPLETED", txId, toJson(event));

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("transactionId", txId);
            response.put("status", "COMPLETED");
            response.put("fromWalletId", fromWalletId);
            response.put("toWalletId", toWalletId);
            response.put("amount", amount.toPlainString());
            response.put("currency", currency.toUpperCase());
            String responseBody = toJson(response);

            if (nonBlank(idempotencyKey)) {
                persistIdempotentResult(con, idempotencyKey, requestHash, 200, txId, responseBody);
            }

            con.commit();
            ctx.status(200);
            ctx.json(response);
        } catch (Exception e) {
            writeError(ctx, 500, "internal server error");
        }
    }

    private void handleGetWallet(Context ctx) {
        String walletId = ctx.pathParam("id");
        try (Connection con = openConnection(); PreparedStatement ps = con.prepareStatement("SELECT id, owner_id, balance, currency FROM wallets WHERE id = ?")) {
            ps.setString(1, walletId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    writeError(ctx, 404, "wallet not found");
                    return;
                }
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("id", rs.getString("id"));
                body.put("ownerId", rs.getString("owner_id"));
                body.put("balance", rs.getBigDecimal("balance").toPlainString());
                body.put("currency", rs.getString("currency"));
                ctx.status(200);
                ctx.json(body);
            }
        } catch (Exception e) {
            writeError(ctx, 500, "internal server error");
        }
    }

    private void handleGetTransfer(Context ctx) {
        String transferId = ctx.pathParam("id");
        try (Connection con = openConnection(); PreparedStatement ps = con.prepareStatement("SELECT id, from_wallet_id, to_wallet_id, amount, currency, status " + "FROM transactions WHERE id = ?")) {
            ps.setString(1, transferId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    writeError(ctx, 404, "transfer not found");
                    return;
                }
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("transactionId", rs.getString("id"));
                body.put("status", rs.getString("status"));
                body.put("fromWalletId", rs.getString("from_wallet_id"));
                body.put("toWalletId", rs.getString("to_wallet_id"));
                body.put("amount", rs.getBigDecimal("amount").toPlainString());
                body.put("currency", rs.getString("currency"));
                ctx.status(200);
                ctx.json(body);
            }
        } catch (Exception e) {
            writeError(ctx, 500, "internal server error");
        }
    }

    private Connection openConnection() throws SQLException {
        return DriverManager.getConnection(jdbcUrl, dbUser, dbPass);
    }

    private void ensureIdempotencyRow(Connection con, String key, String requestHash) throws SQLException {
        executeUpdate(con, "INSERT INTO idempotency_keys (key, request_hash) VALUES (?, ?) " + "ON CONFLICT (key) DO NOTHING", key, requestHash);
    }

    private IdempotencyState lockIdempotencyRow(Connection con, String key) throws SQLException {
        try (PreparedStatement ps = con.prepareStatement("SELECT request_hash, status_code, response_body FROM idempotency_keys WHERE key = ? FOR UPDATE")) {
            ps.setString(1, key);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return new IdempotencyState(null, null, null);
                }
                return new IdempotencyState(rs.getString("request_hash"), (Integer) rs.getObject("status_code"), rs.getString("response_body"));
            }
        }
    }

    private void persistIdempotentResult(Connection con, String key, String requestHash, int statusCode, String transactionId, String responseBody) throws SQLException {
        executeUpdate(con, "UPDATE idempotency_keys " + "SET request_hash = ?, status_code = ?, transaction_id = ?, response_body = ?, updated_at = NOW() " + "WHERE key = ?", requestHash, statusCode, transactionId, responseBody, key);
    }

    private WalletRow lockWallet(Connection con, String walletId) throws SQLException {
        try (PreparedStatement ps = con.prepareStatement("SELECT id, owner_id, balance, currency FROM wallets WHERE id = ? FOR UPDATE")) {
            ps.setString(1, walletId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                return new WalletRow(rs.getString("id"), rs.getString("owner_id"), rs.getBigDecimal("balance"), rs.getString("currency"));
            }
        }
    }

    private void insertAudit(Connection con, String id, String eventType, String resourceType, String resourceId, String details) throws SQLException {
        executeUpdate(con, "INSERT INTO audit_events (id, event_type, resource_type, resource_id, details) " + "VALUES (?, ?, ?, ?, ?)", id, eventType, resourceType, resourceId, details);
    }

    private int executeUpdate(Connection con, String sql, Object... args) throws SQLException {
        try (PreparedStatement ps = con.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                ps.setObject(i + 1, args[i]);
            }
            return ps.executeUpdate();
        }
    }

    private String validateTransfer(String fromWalletId, String toWalletId, String currency, BigDecimal amount) {
        if (!nonBlank(fromWalletId)) {
            return "fromWalletId is required";
        }
        if (!nonBlank(toWalletId)) {
            return "toWalletId is required";
        }
        if (fromWalletId.equals(toWalletId)) {
            return "fromWalletId and toWalletId must be different";
        }
        if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
            return "amount must be greater than zero";
        }
        if (!"USD".equalsIgnoreCase(currency)) {
            return "currency must be USD";
        }
        return null;
    }

    private BigDecimal parseAmount(Object amountObj) {
        if (amountObj == null) {
            return null;
        }
        try {
            return new BigDecimal(String.valueOf(amountObj));
        } catch (Exception e) {
            return null;
        }
    }

    private void writeError(Context ctx, int status, String message) {
        ctx.status(status);
        ctx.json(Map.of("error", message));
    }

    private String hashPayload(String fromWalletId, String toWalletId, BigDecimal amount, String currency) {
        String canonical = fromWalletId + "|" + toWalletId + "|" + amount.stripTrailingZeros().toPlainString() + "|" + currency.toUpperCase();
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("Unable to compute request hash", e);
        }
    }

    private String toJson(Map<String, Object> body) {
        try {
            return MAPPER.writeValueAsString(body);
        } catch (Exception e) {
            throw new IllegalStateException("Unable to serialize json", e);
        }
    }

    private record WalletRow(String id, String ownerId, BigDecimal balance, String currency) {
    }

    private record IdempotencyState(String requestHash, Integer statusCode, String responseBody) {
    }
}
