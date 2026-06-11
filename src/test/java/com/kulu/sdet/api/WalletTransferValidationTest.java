package com.kulu.sdet.api;

import com.kulu.sdet.fixtures.TransferRequestBuilder;
import com.kulu.sdet.fixtures.WalletBuilder;
import com.kulu.sdet.model.TransferRequest;
import com.kulu.sdet.model.TransferResponse;
import com.kulu.sdet.model.Wallet;
import com.kulu.sdet.support.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.math.BigDecimal;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

@Tag("validation")
@Testcontainers
@DisplayName("Wallet Transfer — Input Validation")
class WalletTransferValidationTest {


    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(TestConfig.DB_IMAGE).withDatabaseName(TestConfig.DB_NAME).withUsername(TestConfig.DB_USER).withPassword(TestConfig.DB_PASS);

    private WalletTransferClient client;
    private DbClient db;
    private WalletRepository wallets;
    private TransferRepository transfers;


    private BigDecimal senderBalanceBefore;
    private BigDecimal receiverBalanceBefore;
    private String senderWalletId;
    private String receiverWalletId;

    static Stream<Arguments> invalidRequests() {
        return Stream.of(

                Arguments.of("Missing required field: toWalletId absent", TransferRequestBuilder.withMissingToWallet().build(), 400),

                Arguments.of("Negative amount", TransferRequestBuilder.withNegativeAmount().build(), 400),

                Arguments.of("Zero amount", TransferRequestBuilder.withZeroAmount().build(), 400),

                Arguments.of("Invalid currency code", TransferRequestBuilder.withInvalidCurrency().build(), 400),

                Arguments.of("Same source and destination wallet", TransferRequestBuilder.withSameSourceAndDestination().build(), 400));
    }

    @BeforeEach
    void setUp() throws Exception {
        db = new DbClient(POSTGRES);
        client = new WalletTransferClient();
        wallets = new WalletRepository(db);
        transfers = new TransferRepository(db);

        Wallet sender = WalletBuilder.anAlphaWallet().withOwnerId("owner-alpha").build();
        Wallet receiver = WalletBuilder.aBetaWallet().withOwnerId("owner-beta").build();
        senderWalletId = sender.getId();
        receiverWalletId = receiver.getId();

        DatabaseSeeder.applySchema(db);
        DatabaseSeeder.seedWallets(db, sender, receiver);

        senderBalanceBefore = wallets.balanceOf(senderWalletId);
        receiverBalanceBefore = wallets.balanceOf(receiverWalletId);
    }

    @AfterEach
    void tearDown() throws Exception {
        db.close();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidRequests")
    @DisplayName("Rejected transfer leaves no side effects")
    void transfer_invalid_rejectedWithNoSideEffects(String scenarioName, TransferRequest request, int expectedStatus) throws Exception {


        TransferResponse response = client.createTransfer(request);


        assertErrorResponse(scenarioName, response, expectedStatus);


        assertNoBalanceChange(scenarioName);


        assertNoTransactionPersisted(scenarioName);
        assertNoAuditEventPersisted(scenarioName);
        assertNoOutboxEventPersisted(scenarioName);
    }

    private void assertErrorResponse(String scenario, TransferResponse response, int expectedStatus) {
        assertEquals(expectedStatus, response.getStatusCode(), String.format("[%s] Expected HTTP %d but got %d", scenario, expectedStatus, response.getStatusCode()));

        assertNotNull(response.getErrorMessage(), String.format("[%s] Error response must include an 'error' field", scenario));

        assertFalse(response.getErrorMessage().isBlank(), String.format("[%s] Error message must not be blank — clients need actionable feedback", scenario));
    }


    private void assertNoBalanceChange(String scenario) throws Exception {
        BigDecimal senderAfter = wallets.balanceOf(senderWalletId);
        BigDecimal receiverAfter = wallets.balanceOf(receiverWalletId);

        assertEquals(0, senderBalanceBefore.compareTo(senderAfter), String.format("[%s] Sender balance must not change on rejection. before=%s after=%s", scenario, senderBalanceBefore, senderAfter));

        assertEquals(0, receiverBalanceBefore.compareTo(receiverAfter), String.format("[%s] Receiver balance must not change on rejection. before=%s after=%s", scenario, receiverBalanceBefore, receiverAfter));
    }


    private void assertNoTransactionPersisted(String scenario) throws Exception {
        long count = transfers.countAll();
        assertEquals(0, count, String.format("[%s] Expected 0 transactions rows but found %d", scenario, count));
    }


    private void assertNoAuditEventPersisted(String scenario) throws Exception {
        long count = transfers.countAuditEventsRecent();
        assertEquals(0, count, String.format("[%s] Expected 0 audit_events rows but found %d", scenario, count));
    }


    private void assertNoOutboxEventPersisted(String scenario) throws Exception {
        long count = transfers.countOutboxEventsRecent();
        assertEquals(0, count, String.format("[%s] Expected 0 outbox_events rows but found %d", scenario, count));
    }
}
