package com.kulu.wallet.support;

import static org.assertj.core.api.Assertions.assertThat;

import com.kulu.wallet.db.Database;
import com.kulu.wallet.db.EventRepository;
import com.kulu.wallet.db.IdempotencyRepository;
import com.kulu.wallet.db.TransferRepository;
import com.kulu.wallet.db.WalletRepository;
import com.kulu.wallet.domain.Transfer;
import com.kulu.wallet.domain.TransferStatus;
import com.kulu.wallet.domain.Wallet;
import com.kulu.wallet.service.TransferService;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;

public class DbAssertions {
  private final Database database;
  private final WalletRepository walletRepository;
  private final TransferRepository transferRepository;
  private final IdempotencyRepository idempotencyRepository;
  private final EventRepository eventRepository;

  public DbAssertions(
      Database database,
      WalletRepository walletRepository,
      TransferRepository transferRepository,
      IdempotencyRepository idempotencyRepository,
      EventRepository eventRepository) {
    this.database = database;
    this.walletRepository = walletRepository;
    this.transferRepository = transferRepository;
    this.idempotencyRepository = idempotencyRepository;
    this.eventRepository = eventRepository;
  }

  public Wallet wallet(String walletId) {
    try (Connection connection = database.getConnection()) {
      return walletRepository
          .findById(connection, walletId)
          .orElseThrow(() -> new AssertionError("Wallet not found: " + walletId));
    } catch (SQLException e) {
      throw new AssertionError(e);
    }
  }

  public Transfer transfer(String transferId) {
    try (Connection connection = database.getConnection()) {
      return transferRepository
          .findById(connection, transferId)
          .orElseThrow(() -> new AssertionError("Transfer not found: " + transferId));
    } catch (SQLException e) {
      throw new AssertionError(e);
    }
  }

  public void assertBalances(String sourceId, long sourceBalance, String destId, long destBalance) {
    assertThat(wallet(sourceId).balance()).isEqualTo(sourceBalance);
    assertThat(wallet(destId).balance()).isEqualTo(destBalance);
  }

  public void assertSuccessfulTransferPersisted(
      String transferId, String sourceId, String destId, long amount, String currency) {
    Transfer transfer = transfer(transferId);
    assertThat(transfer.status()).isEqualTo(TransferStatus.COMPLETED);
    assertThat(transfer.sourceWalletId()).isEqualTo(sourceId);
    assertThat(transfer.destinationWalletId()).isEqualTo(destId);
    assertThat(transfer.amount()).isEqualTo(amount);
    assertThat(transfer.currency()).isEqualTo(currency);

    try (Connection connection = database.getConnection()) {
      List<String> events = eventRepository.listTransferEventTypes(connection, transferId);
      assertThat(events).contains("COMPLETED");
      assertThat(
              eventRepository.countOutboxForAggregate(
                  connection, transferId, TransferService.OUTBOX_EVENT_TYPE))
          .isEqualTo(1);
      assertThat(idempotencyRepository.find(connection, findKeyForTransfer(connection, transferId)))
          .isPresent();
    } catch (SQLException e) {
      throw new AssertionError(e);
    }
  }

  public void assertNoOutboxFor(String transferId) {
    try (Connection connection = database.getConnection()) {
      assertThat(
              eventRepository.countOutboxForAggregate(
                  connection, transferId, TransferService.OUTBOX_EVENT_TYPE))
          .isZero();
    } catch (SQLException e) {
      throw new AssertionError(e);
    }
  }

  public void assertTransferCount(long expected) {
    try (Connection connection = database.getConnection()) {
      assertThat(transferRepository.countAll(connection)).isEqualTo(expected);
    } catch (SQLException e) {
      throw new AssertionError(e);
    }
  }

  public void assertIdempotencyCount(long expected) {
    try (Connection connection = database.getConnection()) {
      assertThat(idempotencyRepository.countAll(connection)).isEqualTo(expected);
    } catch (SQLException e) {
      throw new AssertionError(e);
    }
  }

  public void assertOutboxCount(long expected) {
    try (Connection connection = database.getConnection()) {
      assertThat(eventRepository.countAllOutbox(connection)).isEqualTo(expected);
    } catch (SQLException e) {
      throw new AssertionError(e);
    }
  }

  public void assertRejectedInsufficientFunds(String transferId) {
    Transfer transfer = transfer(transferId);
    assertThat(transfer.status()).isEqualTo(TransferStatus.REJECTED_INSUFFICIENT_FUNDS);
    assertNoOutboxFor(transferId);
    try (Connection connection = database.getConnection()) {
      assertThat(eventRepository.listTransferEventTypes(connection, transferId))
          .contains("REJECTED_INSUFFICIENT_FUNDS");
    } catch (SQLException e) {
      throw new AssertionError(e);
    }
  }

  private String findKeyForTransfer(Connection connection, String transferId) throws SQLException {
    try (var ps =
        connection.prepareStatement(
            "SELECT idempotency_key FROM idempotency_keys WHERE transfer_id = ?"); ) {
      ps.setString(1, transferId);
      try (var rs = ps.executeQuery()) {
        if (!rs.next()) {
          throw new AssertionError("No idempotency row for transfer " + transferId);
        }
        return rs.getString(1);
      }
    }
  }
}
