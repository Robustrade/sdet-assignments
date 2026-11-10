package com.billing.specs;

import com.billing.domain.SubscriptionStatus;
import com.billing.domain.Invoice;
import org.testng.annotations.Test;

import static com.billing.builders.WebhookPayloadBuilder.*;
import static org.assertj.core.api.Assertions.assertThat;

@Test
public class StateMachineTest extends BaseTest {

    @Test(description = "trialing -> active via payment.succeeded webhook")
    public void trialingToActive() {
        String id = subscriptionsPage.createDefaultAndGetId();
        assertions.assertPersistedStatus(id, SubscriptionStatus.TRIALING);

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_t2a"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
    }

    @Test(description = "trialing -> past_due via payment.failed webhook")
    public void trialingToPastDue() {
        String id = subscriptionsPage.createDefaultAndGetId();

        webhooksPage.sendValid(aPaymentFailed(id, "inv_001").withEventId("evt_t2pd"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.PAST_DUE);
    }

    @Test(description = "trialing -> canceled via API cancel")
    public void trialingToCanceled() {
        String id = subscriptionsPage.createDefaultAndGetId();

        subscriptionsPage.cancel(id);

        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
    }

    @Test(description = "active -> past_due via payment.failed webhook")
    public void activeToPastDue() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_a_ok"));

        webhooksPage.sendValid(aPaymentFailed(id, "inv_002").withEventId("evt_a2pd"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.PAST_DUE);
    }

    @Test(description = "active -> canceled via API cancel")
    public void activeToCanceled() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_a_ok2"));

        subscriptionsPage.cancel(id);

        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
    }

    @Test(description = "successful recurring payment records an invoice without changing active state")
    public void activeRecurringPaymentSuccessPersistsInvoice() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_first").withEventId("evt_first_paid"));

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_recurring").withEventId("evt_recurring_paid"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertions.assertInvoiceCount(id, 2);
        assertThat(context.getInvoiceRepository().findById("inv_recurring").orElseThrow().getStatus())
            .isEqualTo(Invoice.Status.PAID);
    }

    @Test(description = "past_due -> active via payment.succeeded webhook on retry")
    public void pastDueToActive() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentFailed(id, "inv_001").withEventId("evt_pd_fail"));

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_002").withEventId("evt_pd2a"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
    }

    @Test(description = "past_due -> canceled after three distinct failed payment attempts")
    public void retryExhaustionCancelsSubscription() {
        String id = subscriptionsPage.createDefaultAndGetId();

        webhooksPage.sendValid(aPaymentFailed(id, "inv_retry_1").withEventId("evt_retry_fail_1"));
        webhooksPage.sendValid(aPaymentFailed(id, "inv_retry_2").withEventId("evt_retry_fail_2"));
        assertions.assertPersistedStatus(id, SubscriptionStatus.PAST_DUE);

        webhooksPage.sendValid(aPaymentFailed(id, "inv_retry_3").withEventId("evt_retry_fail_3"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
        assertThat(subscriptionsPage.getById(id).jsonPath().getString("status"))
            .isEqualTo("canceled");
        assertions.assertInvoiceCount(id, 3);
        assertions.assertNoPaidInvoice(id);
    }

    @Test(description = "successful retry resets the failed-attempt count")
    public void successfulRetryResetsFailureCount() {
        String id = subscriptionsPage.createDefaultAndGetId();

        webhooksPage.sendValid(aPaymentFailed(id, "inv_before_1").withEventId("evt_before_fail_1"));
        webhooksPage.sendValid(aPaymentFailed(id, "inv_before_2").withEventId("evt_before_fail_2"));
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_retry_success").withEventId("evt_retry_success"));

        webhooksPage.sendValid(aPaymentFailed(id, "inv_after_1").withEventId("evt_after_fail_1"));
        webhooksPage.sendValid(aPaymentFailed(id, "inv_after_2").withEventId("evt_after_fail_2"));
        assertions.assertPersistedStatus(id, SubscriptionStatus.PAST_DUE);

        webhooksPage.sendValid(aPaymentFailed(id, "inv_after_3").withEventId("evt_after_fail_3"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
    }

    @Test(description = "past_due -> canceled via API cancel")
    public void pastDueToCanceled() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentFailed(id, "inv_001").withEventId("evt_pd_fail2"));

        subscriptionsPage.cancel(id);

        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
    }

    @Test(description = "canceled -> active via payment.succeeded is silently ignored")
    public void canceledDoesNotReactivateOnPaymentSucceeded() {
        String id = subscriptionsPage.createDefaultAndGetId();
        subscriptionsPage.cancel(id);

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_stray").withEventId("evt_stray_1"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
    }

    @Test(description = "canceled -> past_due via payment.failed is silently ignored")
    public void canceledDoesNotMoveToPastDueOnPaymentFailed() {
        String id = subscriptionsPage.createDefaultAndGetId();
        subscriptionsPage.cancel(id);

        webhooksPage.sendValid(aPaymentFailed(id, "inv_stray").withEventId("evt_stray_2"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.CANCELED);
    }

    @Test(description = "late payment.failed after payment.succeeded does not remove the paid invoice")
    public void lateFailedWebhookDoesNotRemovePaidInvoice() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_ok"));

        webhooksPage.sendValid(aPaymentFailed(id, "inv_002").withEventId("evt_late_fail"));

        assertions.assertHasPaidInvoice(id);
        assertions.assertPersistedStatus(id, SubscriptionStatus.PAST_DUE);
    }

    @Test(description = "late failure for a paid invoice is ignored without regressing active state")
    public void lateFailureForSameInvoiceDoesNotRegressState() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_same").withEventId("evt_same_ok"));

        webhooksPage.sendValid(aPaymentFailed(id, "inv_same").withEventId("evt_same_late_fail"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertions.assertInvoiceCount(id, 1);
        assertThat(context.getInvoiceRepository().findById("inv_same").orElseThrow().getStatus())
            .isEqualTo(Invoice.Status.PAID);
        assertThat(context.getWebhookEventRepository().findBySubscriptionId(id))
            .anyMatch(event -> event.getEventId().equals("evt_same_late_fail") && !event.isProcessed());
    }
}
