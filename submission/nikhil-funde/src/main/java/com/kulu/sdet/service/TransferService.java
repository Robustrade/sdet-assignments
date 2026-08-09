package com.kulu.sdet.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.kulu.sdet.service.model.ServiceResult;
import com.kulu.sdet.service.model.TransferRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;

public class TransferService {

  private static final Set<String> VALID_CURRENCIES = Set.of("AED", "USD", "EUR", "GBP");

  private final Connection connection;
  private final ObjectMapper objectMapper;
  private final ReentrantLock lock = new ReentrantLock();

  public TransferService(Connection connection) {
    this.connection = connection;
    this.objectMapper = new ObjectMapper();
    this.objectMapper.configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
  }

  public ServiceResult createTransfer(TransferRequest request, String idempotencyKey) {
    List<String> required =
        List.of("source_wallet_id", "destination_wallet_id", "amount", "currency");
    List<String> missing = new ArrayList<>();
    if (request.sourceWalletId == null) {
      missing.add("source_wallet_id");
    }
    if (request.destinationWalletId == null) {
      missing.add("destination_wallet_id");
    }
    if (request.amount == null) {
      missing.add("amount");
    }
    if (request.currency == null) {
      missing.add("currency");
    }
    if (!missing.isEmpty()) {
      return error(422, Map.of("error", "missing fields", "fields", missing));
    }

    String sourceId = request.sourceWalletId;
    String destId = request.destinationWalletId;
    long amount = request.amount;
    String currency = request.currency;
    String reference = request.reference;

    if (!VALID_CURRENCIES.contains(currency)) {
      return error(422, Map.of("error", "invalid currency"));
    }
    if (amount <= 0) {
      return error(422, Map.of("error", "amount must be positive"));
    }
    if (sourceId.equals(destId)) {
      return error(422, Map.of("error", "source and destination must differ"));
    }

    String payloadHash = hashPayload(sourceId, destId, amount, currency, reference);

    lock.lock();
    try {
      if (idempotencyKey != null && !idempotencyKey.isBlank()) {
        Map<String, Object> existing = findByIdempotencyKey(idempotencyKey);
        if (existing != null) {
          if (!payloadHash.equals(existing.get("payload_hash"))) {
            return error(409, Map.of("error", "idempotency key conflict"));
          }
          existing.remove("payload_hash");
          return new ServiceResult(200, existing);
        }
      }

      Map<String, Object> source = findWallet(sourceId);
      Map<String, Object> dest = findWalletById(destId);

      if (source == null) {
        return error(422, Map.of("error", "source wallet not found"));
      }
      if (dest == null) {
        return error(422, Map.of("error", "destination wallet not found"));
      }
      if (!currency.equals(source.get("currency"))) {
        return error(422, Map.of("error", "currency mismatch"));
      }
      long sourceBalance = ((Number) source.get("balance")).longValue();
      if (sourceBalance < amount) {
        return error(422, Map.of("error", "insufficient balance"));
      }

      String transferId = UUID.randomUUID().toString();
      String now = Instant.now().toString();

      try (PreparedStatement debit =
          connection.prepareStatement("UPDATE wallets SET balance = balance - ? WHERE id = ?")) {
        debit.setLong(1, amount);
        debit.setString(2, sourceId);
        debit.executeUpdate();
      }
      try (PreparedStatement credit =
          connection.prepareStatement("UPDATE wallets SET balance = balance + ? WHERE id = ?")) {
        credit.setLong(1, amount);
        credit.setString(2, destId);
        credit.executeUpdate();
      }
      try (PreparedStatement insertTransfer =
          connection.prepareStatement(
              """
              INSERT INTO transfers
              (id, source_wallet_id, destination_wallet_id, amount, currency,
               reference, status, idempotency_key, payload_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              """)) {
        insertTransfer.setString(1, transferId);
        insertTransfer.setString(2, sourceId);
        insertTransfer.setString(3, destId);
        insertTransfer.setLong(4, amount);
        insertTransfer.setString(5, currency);
        insertTransfer.setString(6, reference);
        insertTransfer.setString(7, "completed");
        insertTransfer.setString(8, idempotencyKey);
        insertTransfer.setString(9, payloadHash);
        insertTransfer.setString(10, now);
        insertTransfer.executeUpdate();
      }
      String auditPayload =
          objectMapper.writeValueAsString(Map.of("amount", amount, "currency", currency));
      insertEvent("audit_events", transferId, "transfer_completed", auditPayload, now);
      insertEvent("outbox_events", transferId, "transfer_published", auditPayload, now);
      connection.commit();

      Map<String, Object> row = findTransferById(transferId);
      return new ServiceResult(201, row);
    } catch (SQLException | JsonProcessingException e) {
      try {
        connection.rollback();
      } catch (SQLException rollbackEx) {
        e.addSuppressed(rollbackEx);
      }
      throw new RuntimeException("Transfer failed", e);
    } finally {
      lock.unlock();
    }
  }

  public Map<String, Object> getTransfer(String transferId) throws SQLException {
    return findTransferById(transferId);
  }

  public Map<String, Object> getWallet(String walletId) throws SQLException {
    return findWallet(walletId);
  }

  private void insertEvent(
      String table, String transferId, String eventType, String payload, String createdAt)
      throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement(
            "INSERT INTO "
                + table
                + " (id, transfer_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?)")) {
      stmt.setString(1, UUID.randomUUID().toString());
      stmt.setString(2, transferId);
      stmt.setString(3, eventType);
      stmt.setString(4, payload);
      stmt.setString(5, createdAt);
      stmt.executeUpdate();
    }
  }

  private Map<String, Object> findByIdempotencyKey(String key) throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement(
            """
            SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
                   reference, status, idempotency_key, created_at, payload_hash
            FROM transfers WHERE idempotency_key = ?
            """)) {
      stmt.setString(1, key);
      try (ResultSet rs = stmt.executeQuery()) {
        if (!rs.next()) {
          return null;
        }
        return rowToTransferMap(rs, true);
      }
    }
  }

  private Map<String, Object> findTransferById(String id) throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement(
            """
            SELECT id, source_wallet_id, destination_wallet_id, amount, currency,
                   reference, status, idempotency_key, created_at
            FROM transfers WHERE id = ?
            """)) {
      stmt.setString(1, id);
      try (ResultSet rs = stmt.executeQuery()) {
        if (!rs.next()) {
          return null;
        }
        return rowToTransferMap(rs, false);
      }
    }
  }

  private Map<String, Object> findWallet(String walletId) throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement("SELECT id, balance, currency FROM wallets WHERE id = ?")) {
      stmt.setString(1, walletId);
      try (ResultSet rs = stmt.executeQuery()) {
        if (!rs.next()) {
          return null;
        }
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", rs.getString("id"));
        row.put("balance", rs.getLong("balance"));
        row.put("currency", rs.getString("currency"));
        return row;
      }
    }
  }

  private Map<String, Object> findWalletById(String walletId) throws SQLException {
    try (PreparedStatement stmt =
        connection.prepareStatement("SELECT id FROM wallets WHERE id = ?")) {
      stmt.setString(1, walletId);
      try (ResultSet rs = stmt.executeQuery()) {
        if (!rs.next()) {
          return null;
        }
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", rs.getString("id"));
        return row;
      }
    }
  }

  private Map<String, Object> rowToTransferMap(ResultSet rs, boolean includePayloadHash)
      throws SQLException {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("id", rs.getString("id"));
    row.put("source_wallet_id", rs.getString("source_wallet_id"));
    row.put("destination_wallet_id", rs.getString("destination_wallet_id"));
    row.put("amount", rs.getLong("amount"));
    row.put("currency", rs.getString("currency"));
    row.put("reference", rs.getString("reference"));
    row.put("status", rs.getString("status"));
    row.put("idempotency_key", rs.getString("idempotency_key"));
    row.put("created_at", rs.getString("created_at"));
    if (includePayloadHash) {
      row.put("payload_hash", rs.getString("payload_hash"));
    }
    return row;
  }

  private String hashPayload(
      String sourceId, String destId, long amount, String currency, String reference) {
    Map<String, Object> canonical = new TreeMap<>();
    canonical.put("amount", amount);
    canonical.put("currency", currency);
    canonical.put("destination_wallet_id", destId);
    canonical.put("reference", reference);
    canonical.put("source_wallet_id", sourceId);
    try {
      String json = objectMapper.writeValueAsString(canonical);
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(json.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (JsonProcessingException | NoSuchAlgorithmException e) {
      throw new RuntimeException("Failed to hash payload", e);
    }
  }

  private ServiceResult error(int status, Map<String, Object> body) {
    return new ServiceResult(status, body);
  }
}
