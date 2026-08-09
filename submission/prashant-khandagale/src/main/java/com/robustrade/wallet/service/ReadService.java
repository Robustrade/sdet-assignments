package com.robustrade.wallet.service;

import com.robustrade.wallet.dao.TransferDao;
import com.robustrade.wallet.dao.WalletDao;
import com.robustrade.wallet.db.Database;
import com.robustrade.wallet.dto.ErrorResponseDto;
import com.robustrade.wallet.dto.TransferResponseDto;
import com.robustrade.wallet.dto.WalletResponseDto;
import com.robustrade.wallet.model.Transfer;
import com.robustrade.wallet.model.Wallet;

import java.sql.Connection;
import java.sql.SQLException;

/** Backs GET /transfers/{id} and GET /wallets/{id}. Plain reads, no locking needed. */
public class ReadService {

    private final Database db;
    private final WalletDao walletDao = new WalletDao();
    private final TransferDao transferDao = new TransferDao();

    public ReadService(Database db) {
        this.db = db;
    }

    public ServiceResult getWallet(String walletId) {
        try (Connection conn = db.getConnection()) {
            return walletDao.findById(conn, walletId)
                    .map(w -> new ServiceResult(200, toDto(w)))
                    .orElse(new ServiceResult(404, new ErrorResponseDto("NOT_FOUND", "Wallet not found: " + walletId)));
        } catch (SQLException e) {
            throw new RuntimeException("Database error while reading wallet", e);
        }
    }

    public ServiceResult getTransfer(String transferId) {
        try (Connection conn = db.getConnection()) {
            return transferDao.findById(conn, transferId)
                    .map(t -> new ServiceResult(200, toDto(t)))
                    .orElse(new ServiceResult(404, new ErrorResponseDto("NOT_FOUND", "Transfer not found: " + transferId)));
        } catch (SQLException e) {
            throw new RuntimeException("Database error while reading transfer", e);
        }
    }

    private WalletResponseDto toDto(Wallet w) {
        return new WalletResponseDto(w.getId(), w.getCurrency(), w.getBalance());
    }

    private TransferResponseDto toDto(Transfer t) {
        TransferResponseDto dto = new TransferResponseDto();
        dto.transferId = t.getId();
        dto.status = t.getStatus().name();
        dto.sourceWalletId = t.getSourceWalletId();
        dto.destinationWalletId = t.getDestinationWalletId();
        dto.amount = t.getAmount();
        dto.currency = t.getCurrency();
        dto.reference = t.getReference();
        dto.rejectionReason = t.getRejectionReason();
        dto.createdAt = t.getCreatedAt().toString();
        return dto;
    }
}
