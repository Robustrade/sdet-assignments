package com.wallet.transfer.repository;

import com.wallet.transfer.model.Transfer;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface TransferRepository {
  Transfer save(Transfer transfer);

  Optional<Transfer> findById(UUID transferId);

  List<Transfer> findAll();

  boolean existsById(UUID transferId);
}
