package com.kulu.sdet.api;

import com.kulu.sdet.fixtures.IdempotencyKeyGenerator;
import com.kulu.sdet.fixtures.TransferRequestBuilder;
import com.kulu.sdet.fixtures.WalletFixtures;
import com.kulu.sdet.model.TransferResponse;
import com.kulu.sdet.model.WalletResponse;
import com.kulu.sdet.support.WalletTransferClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

@Tag("api")
@DisplayName("Wallet Transfer API")
class WalletTransferApiTest {

    private WalletTransferClient client;

    @BeforeEach
    void setUp() {
        client = new WalletTransferClient();
    }


    @Test
    @DisplayName("POST /transfer returns 200 and a transaction ID for a valid request")
    void transfer_validRequest_returns200WithTransactionId() {
        TransferResponse res = client.createTransfer(TransferRequestBuilder.aValidTransfer().build());

        assertEquals(200, res.getStatusCode());
        assertNotNull(res.getTransactionId(), "transactionId must be present");
        assertEquals("COMPLETED", res.getStatus());
    }

    @Test
    @DisplayName("GET /wallets/{id} returns wallet with expected fields")
    void getWallet_existingId_returnsWalletShape() {
        WalletResponse wallet = client.getWallet(WalletFixtures.WALLET_ALPHA);

        assertEquals(200, wallet.getStatusCode());
        assertEquals(WalletFixtures.WALLET_ALPHA, wallet.getId());
        assertNotNull(wallet.getBalance(), "balance must be present");
        assertNotNull(wallet.getCurrency(), "currency must be present");
    }

    @Test
    @DisplayName("GET /wallets/transfer/{id} returns the previously created transfer")
    void getTransfer_existingId_returnsTransfer() {
        TransferResponse created = client.createTransfer(TransferRequestBuilder.aValidTransfer().build());
        assertEquals(200, created.getStatusCode());

        TransferResponse fetched = client.getTransfer(created.getTransactionId());

        assertEquals(200, fetched.getStatusCode());
        assertEquals(created.getTransactionId(), fetched.getTransactionId());
        assertEquals("COMPLETED", fetched.getStatus());
    }

    @Test
    @DisplayName("GET /wallets/transfer/{id} returns 404 for unknown transaction")
    void getTransfer_unknownId_returns404() {
        TransferResponse res = client.getTransfer("does-not-exist-" + IdempotencyKeyGenerator.random());
        assertEquals(404, res.getStatusCode());
    }


    @Test
    @DisplayName("Transfer with amount exceeding balance returns 422")
    void transfer_insufficientFunds_returns422() {
        TransferResponse res = client.createTransfer(TransferRequestBuilder.withInsufficientFunds().build());

        assertEquals(422, res.getStatusCode());
        assertNotNull(res.getErrorMessage());
        assertTrue(res.getErrorMessage().toLowerCase().contains("insufficient"), "Error message should mention insufficient funds");
    }

    @Test
    @DisplayName("Transfer with unknown wallet ID returns 404")
    void transfer_unknownWallet_returns404() {
        TransferResponse res = client.createTransfer(TransferRequestBuilder.withUnknownSender().build());

        assertEquals(404, res.getStatusCode());
    }

    @Test
    @DisplayName("Transfer with missing required field returns 400")
    void transfer_missingToWalletId_returns400() {
        TransferResponse res = client.createTransfer(TransferRequestBuilder.withMissingToWallet().build());

        assertEquals(400, res.getStatusCode());
        assertNotNull(res.getErrorMessage());
    }

    @Test
    @DisplayName("Transfer with negative amount returns 400")
    void transfer_negativeAmount_returns400() {
        TransferResponse res = client.createTransfer(TransferRequestBuilder.withNegativeAmount().build());

        assertEquals(400, res.getStatusCode());
    }
}
