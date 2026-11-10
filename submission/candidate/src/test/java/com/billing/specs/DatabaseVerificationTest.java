package com.billing.specs;

import com.billing.domain.SubscriptionStatus;
import org.testng.annotations.Test;

import static com.billing.builders.SubscriptionRequestBuilder.aSubscription;
import static com.billing.builders.WebhookPayloadBuilder.*;
import static org.assertj.core.api.Assertions.assertThat;

@Test
public class DatabaseVerificationTest extends BaseTest {

    @Test(description = "subscription is persisted with correct initial status on creation")
    public void subscriptionPersistedOnCreation() {
        String id = subscriptionsPage.createDefaultAndGetId();
        assertions.assertPersistedStatus(id, SubscriptionStatus.TRIALING);
    }

    @Test(description = "subscription plan and customer are stored correctly")
    public void subscriptionPlanAndCustomerPersisted() {
        String id = subscriptionsPage.create(
            aSubscription().withCustomerId("cust_001").withPlan("basic").build()
        ).jsonPath().getString("id");

        var sub = context.getSubscriptionRepository().findById(id).orElseThrow();
        assertThat(sub.getCustomerId()).isEqualTo("cust_001");
        assertThat(sub.getPlan().name()).isEqualToIgnoringCase("basic");
    }

    @Test(description = "PAID invoice is written when payment.succeeded webhook is processed")
    public void paidInvoiceWrittenOnSuccess() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_db_ok"));

        assertions.assertInvoiceCount(id, 1);
        assertions.assertHasPaidInvoice(id);
    }

    @Test(description = "FAILED invoice is written when payment.failed webhook is processed")
    public void failedInvoiceWrittenOnFailure() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentFailed(id, "inv_001").withEventId("evt_db_fail"));

        assertions.assertInvoiceCount(id, 1);
        assertions.assertNoPaidInvoice(id);
    }

    @Test(description = "webhook event is recorded in the webhook_events store")
    public void webhookEventRecorded() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_rec_001"));

        assertions.assertWebhookEventRecorded("evt_rec_001");
    }

    @Test(description = "duplicate webhook event is stored only once")
    public void duplicateWebhookStoredOnce() {
        String id = subscriptionsPage.createDefaultAndGetId();
        var builder = aPaymentSucceeded(id, "inv_001").withEventId("evt_dup_001");

        webhooksPage.sendValid(builder);
        webhooksPage.sendValid(builder);

        assertions.assertWebhookEventCount(id, 1);
    }

    @Test(description = "duplicate webhook does not create a duplicate invoice")
    public void duplicateWebhookDoesNotDuplicateInvoice() {
        String id = subscriptionsPage.createDefaultAndGetId();
        var builder = aPaymentSucceeded(id, "inv_001").withEventId("evt_dup_002");

        webhooksPage.sendValid(builder);
        webhooksPage.sendValid(builder);

        assertions.assertInvoiceCount(id, 1);
    }

    @Test(description = "active subscription always has at least one PAID invoice")
    public void activeSubscriptionAlwaysHasPaidInvoice() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_inv_ok"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.ACTIVE);
        assertions.assertHasPaidInvoice(id);
    }

    @Test(description = "past_due subscription has no PAID invoice")
    public void pastDueSubscriptionHasNoPaidInvoice() {
        String id = subscriptionsPage.createDefaultAndGetId();
        webhooksPage.sendValid(aPaymentFailed(id, "inv_001").withEventId("evt_inv_fail"));

        assertions.assertPersistedStatus(id, SubscriptionStatus.PAST_DUE);
        assertions.assertNoPaidInvoice(id);
    }

    @Test(description = "persisted status matches API-visible status at trialing, active, and canceled stages")
    public void persistedStatusMatchesApiStatusAtEveryStage() {
        String id = subscriptionsPage.createDefaultAndGetId();

        String apiStatus = subscriptionsPage.getById(id).jsonPath().getString("status");
        String dbStatus  = context.getSubscriptionRepository().findById(id)
            .map(s -> s.getStatus().name().toLowerCase()).orElseThrow();
        assertThat(apiStatus).isEqualTo(dbStatus);

        webhooksPage.sendValid(aPaymentSucceeded(id, "inv_001").withEventId("evt_match_1"));
        apiStatus = subscriptionsPage.getById(id).jsonPath().getString("status");
        dbStatus  = context.getSubscriptionRepository().findById(id)
            .map(s -> s.getStatus().name().toLowerCase()).orElseThrow();
        assertThat(apiStatus).isEqualTo(dbStatus);

        subscriptionsPage.cancel(id);
        apiStatus = subscriptionsPage.getById(id).jsonPath().getString("status");
        dbStatus  = context.getSubscriptionRepository().findById(id)
            .map(s -> s.getStatus().name().toLowerCase()).orElseThrow();
        assertThat(apiStatus).isEqualTo(dbStatus);
    }
}
