package com.billing.specs;

import com.billing.domain.SubscriptionStatus;
import com.billing.domain.Invoice;
import org.testng.annotations.Test;
import io.restassured.response.Response;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static com.billing.builders.SubscriptionRequestBuilder.aSubscription;
import static com.billing.builders.WebhookPayloadBuilder.*;
import static org.assertj.core.api.Assertions.assertThat;

@Test
public class EndToEndFlowTest extends BaseTest {

    @Test(description = "full happy path: create -> payment.succeeded -> cancel -> stray webhook ignored")
    public void fullHappyPath() {
        String id = subscriptionsPage.createDefaultAndGetId();
        assertions.assertPersistedStatus(id, SubscriptionStatus.TRIALING);

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_e2e_ok"));
        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertions.assertHasPaidInvoice(id);

        subscriptionsPage.cancel(id);
        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_stray").withEventId("evt_stray_e2e"));
        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
    }

    @Test(description = "payment failure then retry succeeds: ends active with 2 invoices")
    public void paymentFailureThenRetrySucceeds() {
        String id = subscriptionsPage.createDefaultAndGetId();

        webhooksPage.sendValid(aPaymentFailed(id, "inv_001").withEventId("evt_fail_e2e"));
        assertions.assertPersistedStatus(id, SubscriptionStatus.PAST_DUE);
        assertions.assertNoPaidInvoice(id);

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_002").withEventId("evt_retry_e2e"));
        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertions.assertHasPaidInvoice(id);
        assertions.assertInvoiceCount(id, 2);
    }

    @Test(description = "triplicate webhook delivery produces exactly one state change and one invoice")
    public void triplicateWebhookIdempotency() {
        String id = subscriptionsPage.createDefaultAndGetId();
        var builder = aPaymentSucceeded(id, "inv_001").withEventId("evt_idem_001");

        webhooksPage.sendValid(builder);
        webhooksPage.sendValid(builder);
        webhooksPage.sendValid(builder);

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertions.assertInvoiceCount(id, 1);
        assertions.assertWebhookEventCount(id, 1);
    }

    @Test(description = "concurrent duplicate deliveries produce one invoice and one event")
    public void concurrentDuplicateWebhookIsProcessedOnce() throws Exception {
        String id = subscriptionsPage.createDefaultAndGetId();
        var builder = aPaymentSucceeded(id, "inv_concurrent")
            .withEventId("evt_concurrent_duplicate");
        int deliveryCount = 8;
        ExecutorService executor = Executors.newFixedThreadPool(deliveryCount);
        CountDownLatch ready = new CountDownLatch(deliveryCount);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Response>> deliveries = new ArrayList<>();

        try {
            for (int deliveryIndex = 0; deliveryIndex < deliveryCount; deliveryIndex++) {
                deliveries.add(executor.submit(() -> {
                    ready.countDown();
                    if (!start.await(5, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Timed out waiting to start webhook delivery");
                    }
                    return webhooksPage.sendValid(builder);
                }));
            }

            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            for (Future<Response> delivery : deliveries) {
                assertThat(delivery.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            }
        } finally {
            start.countDown();
            executor.shutdownNow();
        }

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertions.assertInvoiceCount(id, 1);
        assertions.assertWebhookEventCount(id, 1);
    }

    @Test(description = "concurrent cancellation and success webhook leave subscription canceled")
    public void concurrentCancelAndSuccessKeepsSubscriptionCanceled() throws Exception {
        String id = subscriptionsPage.createDefaultAndGetId();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<Response> cancellation;
        Future<Response> paymentSuccess;

        try {
            cancellation = executor.submit(() -> {
                ready.countDown();
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to start cancellation");
                }
                return subscriptionsPage.cancel(id);
            });
            paymentSuccess = executor.submit(() -> {
                ready.countDown();
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to start webhook delivery");
                }
                return webhooksPage.sendValid(aPaymentSucceeded(id, "inv_cancel_race")
                    .withEventId("evt_cancel_race"));
            });

            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(cancellation.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            assertThat(paymentSuccess.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        } finally {
            start.countDown();
            executor.shutdownNow();
        }

        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
        var invoices = context.getInvoiceRepository().findBySubscriptionId(id);
        assertThat(invoices).hasSizeLessThanOrEqualTo(1);
        assertThat(invoices)
            .allMatch(invoice -> invoice.getId().equals("inv_cancel_race")
                && invoice.getStatus() == Invoice.Status.PAID);
        assertions.assertWebhookEventCount(id, 1);
    }

    @Test(description = "concurrent success and failure for one invoice leave it paid")
    public void concurrentSuccessAndFailureLeaveInvoicePaid() throws Exception {
        String id = subscriptionsPage.createDefaultAndGetId();
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<Response> paymentSuccess;
        Future<Response> paymentFailure;

        try {
            paymentSuccess = executor.submit(() -> {
                ready.countDown();
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to start success webhook");
                }
                return webhooksPage.sendValid(aPaymentSucceeded(id, "inv_event_race")
                    .withEventId("evt_race_success"));
            });
            paymentFailure = executor.submit(() -> {
                ready.countDown();
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to start failure webhook");
                }
                return webhooksPage.sendValid(aPaymentFailed(id, "inv_event_race")
                    .withEventId("evt_race_failure"));
            });

            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(paymentSuccess.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
            assertThat(paymentFailure.get(10, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        } finally {
            start.countDown();
            executor.shutdownNow();
        }

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertThat(context.getInvoiceRepository().findById("inv_event_race").orElseThrow().getStatus())
            .isEqualTo(Invoice.Status.PAID);
        assertThat(context.getWebhookEventRepository().findBySubscriptionId(id))
            .hasSize(2)
            .anyMatch(event -> event.getEventId().equals("evt_race_success") && event.isProcessed());
    }

    @Test(description = "late payment.failed does not remove the original paid invoice")
    public void outOfOrderWebhookPreservesPaidInvoice() {
        String id = subscriptionsPage.createDefaultAndGetId();

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_oo_ok"));
        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);

        webhooksPage.sendValid(aPaymentFailed(id, "inv_002").withEventId("evt_oo_fail"));

        assertions.assertHasPaidInvoice(id);
        assertions.assertInvoiceCount(id, 2);
    }

    @Test(description = "refund updates the invoice and is retained in webhook audit history")
    public void refundUpdatesInvoiceAndRecordsEvent() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_refund").withEventId("evt_refund_paid"));

        webhooksPage.sendValid(aPaymentRefunded(id, "inv_refund").withEventId("evt_refunded"));

        assertThat(context.getInvoiceRepository().findById("inv_refund").orElseThrow().getStatus())
            .isEqualTo(Invoice.Status.REFUNDED);
        assertions.assertPersistedStatus(id, SubscriptionStatus.PAST_DUE);
        assertThat(context.getWebhookEventRepository().findBySubscriptionId(id))
            .anyMatch(event -> event.getEventId().equals("evt_refunded") && event.isProcessed());
    }

    @Test(description = "webhook cannot reuse an invoice belonging to another subscription")
    public void webhookCannotReassignAnotherSubscriptionsInvoice() {
        String originalSubscriptionId = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentFailed(originalSubscriptionId, "inv_shared")
            .withEventId("evt_shared_invoice_failed"));

        String otherSubscriptionId = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(otherSubscriptionId, "inv_shared")
            .withEventId("evt_shared_invoice_paid"));

        assertions.assertPersistedStatus(originalSubscriptionId, SubscriptionStatus.PAST_DUE);
        assertions.assertPersistedStatus(otherSubscriptionId, SubscriptionStatus.TRIALING);
        assertThat(context.getInvoiceRepository().findById("inv_shared").orElseThrow().getSubscriptionId())
            .isEqualTo(originalSubscriptionId);
        assertThat(context.getInvoiceRepository().findById("inv_shared").orElseThrow().getStatus())
            .isEqualTo(Invoice.Status.FAILED);
        assertThat(context.getWebhookEventRepository().findBySubscriptionId(otherSubscriptionId))
            .anyMatch(event -> event.getEventId().equals("evt_shared_invoice_paid") && !event.isProcessed());
    }

    @Test(description = "refund webhook cannot refund another subscription's invoice")
    public void refundCannotChangeAnotherSubscriptionsInvoice() {
        String invoiceOwnerId = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(invoiceOwnerId, "inv_owned")
            .withEventId("evt_invoice_owner_paid"));

        String otherSubscriptionId = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentRefunded(otherSubscriptionId, "inv_owned")
            .withEventId("evt_foreign_refund"));

        assertThat(context.getInvoiceRepository().findById("inv_owned").orElseThrow().getStatus())
            .isEqualTo(Invoice.Status.PAID);
        assertThat(context.getWebhookEventRepository().findBySubscriptionId(otherSubscriptionId))
            .anyMatch(event -> event.getEventId().equals("evt_foreign_refund") && !event.isProcessed());
        assertions.assertPersistedStatus(otherSubscriptionId, SubscriptionStatus.TRIALING);
    }

    @Test(description = "success webhook with an amount different from the plan price is ignored")
    public void successWebhookWithMismatchedAmountIsIgnored() {
        String id = subscriptionsPage.createDefaultAndGetId();

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_wrong_amount")
            .withAmount(1)
            .withEventId("evt_wrong_amount"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.TRIALING);
        assertions.assertInvoiceCount(id, 0);
        assertThat(context.getWebhookEventRepository().findBySubscriptionId(id))
            .anyMatch(event -> event.getEventId().equals("evt_wrong_amount") && !event.isProcessed());
    }

    @Test(description = "failed webhook with an amount different from the plan price is ignored")
    public void failedWebhookWithMismatchedAmountIsIgnored() {
        String id = subscriptionsPage.createDefaultAndGetId();

        webhooksPage.sendValid(aPaymentFailed(id, "inv_failed_wrong_amount")
            .withAmount(1)
            .withEventId("evt_failed_wrong_amount"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.TRIALING);
        assertions.assertInvoiceCount(id, 0);
        assertThat(context.getWebhookEventRepository().findBySubscriptionId(id))
            .anyMatch(event -> event.getEventId().equals("evt_failed_wrong_amount") && !event.isProcessed());
    }

    @Test(description = "refund webhook with an amount different from the invoice is ignored")
    public void refundWebhookWithMismatchedAmountIsIgnored() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_refund_wrong_amount")
            .withEventId("evt_paid_before_wrong_refund"));

        webhooksPage.sendValid(aPaymentRefunded(id, "inv_refund_wrong_amount")
            .withAmount(1)
            .withEventId("evt_refund_wrong_amount"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertThat(context.getInvoiceRepository().findById("inv_refund_wrong_amount")
            .orElseThrow().getStatus()).isEqualTo(Invoice.Status.PAID);
        assertThat(context.getWebhookEventRepository().findBySubscriptionId(id))
            .anyMatch(event -> event.getEventId().equals("evt_refund_wrong_amount") && !event.isProcessed());
    }

    @Test(description = "invalid signature webhook does not change subscription state")
    public void invalidSignatureWebhookDoesNotChangeState() {
        String id = subscriptionsPage.createDefaultAndGetId();

        webhooksPage.sendWithInvalidSignature(
            aPaymentSucceeded(id, "inv_001").withEventId("evt_badsig_e2e"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.TRIALING);
    }

    @Test(description = "basic plan starts trialing with correct price of 1900 cents")
    public void basicPlanHasCorrectPriceAndStartsTrialing() {
        String id = subscriptionsPage.create(
            aSubscription().withPlan("basic").build()
        ).jsonPath().getString("id");

        var sub = context.getSubscriptionRepository().findById(id).orElseThrow();
        assertThat(sub.getStatus()).isEqualTo(SubscriptionStatus.TRIALING);
        assertThat(sub.getPlan().getPriceInCents()).isEqualTo(1900);
    }

    @Test(description = "pro plan starts trialing with correct price of 4900 cents")
    public void proPlanHasCorrectPriceAndStartsTrialing() {
        String id = subscriptionsPage.createDefaultAndGetId();

        var sub = context.getSubscriptionRepository().findById(id).orElseThrow();
        assertThat(sub.getStatus()).isEqualTo(SubscriptionStatus.TRIALING);
        assertThat(sub.getPlan().getPriceInCents()).isEqualTo(4900);
    }
}
