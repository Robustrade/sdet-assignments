package com.wallet.transfer.repository;

import com.wallet.transfer.model.Transfer;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

public class InMemoryTransferRepository implements TransferRepository {
  private final ConcurrentMap<UUID, Transfer> transfers = new ConcurrentHashMap<>();

  @Override
  public Transfer save(Transfer transfer) {
    transfers.put(transfer.transferId(), transfer);
    return transfer;
  }

  @Override
  public Optional<Transfer> findById(UUID transferId) {
    return Optional.ofNullable(transfers.get(transferId));
  }

  @Override
  public List<Transfer> findAll() {
    return new ArrayList<>(transfers.values());
  }

  @Override
  public boolean existsById(UUID transferId) {
    return transfers.containsKey(transferId);
  }

  public void clear() {
    transfers.clear();
  }
}
