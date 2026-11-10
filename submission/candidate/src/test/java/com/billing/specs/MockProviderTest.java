package com.billing.specs;

import org.testng.annotations.Test;
import com.billing.domain.Invoice;
import com.billing.domain.SubscriptionStatus;
import com.billing.service.PaymentProviderTimeoutException;

import static com.billing.builders.SubscriptionRequestBuilder.aSubscription;
import static com.billing.builders.WebhookPayloadBuilder.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.testng.Assert.assertThrows;

@Test
public class MockProviderTest extends BaseTest {

    @Test(description = "provider is not called when creating a trialing subscription")
    public void providerNotCalledForTrialingSubscription() {
        subscriptionsPage.createDefault();

        assertThat(mockProvider.callCount()).isZero();
    }

    @Test(description = "provider is not called for an invalid subscription creation")
    public void providerNotCalledOnValidationFailure() {
        subscriptionsPage.create(aSubscription().withPlan("nonexistent").build());

        assertThat(mockProvider.callCount()).isZero();
    }

    @Test(description = "provider is not called when the customer does not exist")
    public void providerNotCalledForUnknownCustomer() {
        subscriptionsPage.create(
            aSubscription().withCustomerId("cust_unknown").withPlan("immediate").build());

        assertThat(mockProvider.callCount()).isZero();
        assertThat(context.getSubscriptionRepository().count()).isZero();
    }

    @Test(description = "provider is not called when a webhook is replayed")
    public void providerNotCalledOnReplayedWebhook() {
        String id = subscriptionsPage.createDefaultAndGetId();
        var builder = aPaymentSucceeded(id, "inv_001").withEventId("evt_replay");

        webhooksPage.sendValid(builder);
        webhooksPage.sendValid(builder);

        assertThat(mockProvider.callCount()).isZero();
    }

    @Test(description = "provider records correct customer, payment method, and amount")
    public void providerRecordsCorrectArguments() {
        mockProvider.willSucceed();
        mockProvider.charge("cust_001", "pm_test_visa_4242", 4900, "inv_direct_001");

        assertThat(mockProvider.callCount()).isEqualTo(1);

        var call = mockProvider.lastCall();
        assertThat(call.customerId()).isEqualTo("cust_001");
        assertThat(call.paymentMethodId()).isEqualTo("pm_test_visa_4242");
        assertThat(call.amountInCents()).isEqualTo(4900);
        assertThat(call.idempotencyKey()).isEqualTo("inv_direct_001");
    }

    @Test(description = "immediate plan creation calls provider once and persists a paid invoice")
    public void immediateChargeSuccessIsIntegratedWithSubscriptionCreation() {
        mockProvider.willSucceed();
        var response = subscriptionsPage.create(aSubscription().withPlan("immediate").build());
        String subscriptionId = response.jsonPath().getString("id");

        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.jsonPath().getString("status")).isEqualTo("active");
        assertions.assertPersistedStatus(subscriptionId, SubscriptionStatus.ACTIVE);
        assertions.assertInvoiceCount(subscriptionId, 1);
        assertions.assertHasPaidInvoice(subscriptionId);
        assertThat(mockProvider.callCount()).isEqualTo(1);
        var call = mockProvider.lastCall();
        assertThat(call.customerId()).isEqualTo("cust_001");
        assertThat(call.paymentMethodId()).isEqualTo("pm_test_visa_4242");
        assertThat(call.amountInCents()).isEqualTo(9900);
        assertThat(context.getInvoiceRepository().findBySubscriptionId(subscriptionId).get(0).getId())
            .isEqualTo(call.idempotencyKey());
    }

    @Test(description = "provider decline creates a past_due subscription and failed invoice")
    public void immediateChargeDeclineIsPersisted() {
        mockProvider.willDecline();
        var response = subscriptionsPage.create(aSubscription().withPlan("immediate").build());
        String subscriptionId = response.jsonPath().getString("id");

        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.jsonPath().getString("status")).isEqualTo("past_due");
        assertions.assertPersistedStatus(subscriptionId, SubscriptionStatus.PAST_DUE);
        assertions.assertInvoiceCount(subscriptionId, 1);
        assertThat(context.getInvoiceRepository().findBySubscriptionId(subscriptionId).get(0).getStatus())
            .isEqualTo(Invoice.Status.FAILED);
        assertThat(mockProvider.callCount()).isEqualTo(1);
    }

    @Test(description = "provider timeout remains pending for reconciliation")
    public void immediateChargeTimeoutIsPersisted() {
        mockProvider.willTimeout();
        var response = subscriptionsPage.create(aSubscription().withPlan("immediate").build());
        String subscriptionId = response.jsonPath().getString("id");

        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.jsonPath().getString("status")).isEqualTo("past_due");
        assertions.assertPersistedStatus(subscriptionId, SubscriptionStatus.PAST_DUE);
        assertThat(context.getInvoiceRepository().findBySubscriptionId(subscriptionId).get(0).getStatus())
            .isEqualTo(Invoice.Status.PENDING);
        assertThat(mockProvider.callCount()).isEqualTo(1);
    }

    @Test(description = "retry after a confirmed decline can recover the subscription")
    public void retryAfterDeclineCanSucceed() {
        mockProvider.willDecline();
        var response = subscriptionsPage.create(aSubscription().withPlan("immediate").build());
        String subscriptionId = response.jsonPath().getString("id");

        mockProvider.willSucceed();
        context.getSubscriptionService().retryPayment(subscriptionId);

        assertions.assertPersistedStatus(subscriptionId, SubscriptionStatus.ACTIVE);
        assertions.assertInvoiceCount(subscriptionId, 2);
        assertThat(mockProvider.callCount()).isEqualTo(2);
        var retryInvoice = context.getInvoiceRepository().findBySubscriptionId(subscriptionId).stream()
            .filter(invoice -> invoice.getStatus() == Invoice.Status.PAID)
            .findFirst()
            .orElseThrow();
        var retryCall = mockProvider.lastCall();
        assertThat(retryCall.customerId()).isEqualTo("cust_001");
        assertThat(retryCall.paymentMethodId()).isEqualTo("pm_test_visa_4242");
        assertThat(retryCall.amountInCents()).isEqualTo(9900);
        assertThat(retryCall.idempotencyKey()).isEqualTo(retryInvoice.getId());
    }

    @Test(description = "retry does not charge again while a provider timeout is unresolved")
    public void unresolvedTimeoutWaitsForWebhookReconciliation() {
        mockProvider.willTimeout();
        var response = subscriptionsPage.create(aSubscription().withPlan("immediate").build());
        String subscriptionId = response.jsonPath().getString("id");
        var pendingInvoice = context.getInvoiceRepository().findBySubscriptionId(subscriptionId).get(0);

        mockProvider.willSucceed();
        context.getSubscriptionService().retryPayment(subscriptionId);

        assertThat(mockProvider.callCount()).isEqualTo(1);
        assertions.assertPersistedStatus(subscriptionId, SubscriptionStatus.PAST_DUE);
        webhooksPage.sendValid(aPaymentSucceeded(subscriptionId, pendingInvoice.getId())
            .withAmount(9900)
            .withEventId("evt_timeout_reconciled"));

        assertions.assertPersistedStatus(subscriptionId, SubscriptionStatus.ACTIVE);
        assertThat(context.getInvoiceRepository().findById(pendingInvoice.getId()).orElseThrow().getStatus())
            .isEqualTo(Invoice.Status.PAID);
        assertThat(mockProvider.callCount()).isEqualTo(1);
    }

    @Test(description = "failed webhook resolves a timeout and permits a later retry")
    public void failedWebhookResolvesTimeoutBeforeRetry() {
        mockProvider.willTimeout();
        var response = subscriptionsPage.create(aSubscription().withPlan("immediate").build());
        String subscriptionId = response.jsonPath().getString("id");
        var pendingInvoice = context.getInvoiceRepository().findBySubscriptionId(subscriptionId).get(0);

        webhooksPage.sendValid(aPaymentFailed(subscriptionId, pendingInvoice.getId())
            .withAmount(9900)
            .withEventId("evt_timeout_declined"));
        assertThat(context.getInvoiceRepository().findById(pendingInvoice.getId()).orElseThrow().getStatus())
            .isEqualTo(Invoice.Status.FAILED);

        mockProvider.willSucceed();
        context.getSubscriptionService().retryPayment(subscriptionId);

        assertions.assertPersistedStatus(subscriptionId, SubscriptionStatus.ACTIVE);
        assertions.assertInvoiceCount(subscriptionId, 2);
        assertThat(mockProvider.callCount()).isEqualTo(2);
    }

    @Test(description = "retry attempts stop charging when the third consecutive attempt fails")
    public void retryExhaustionStopsFurtherCharges() {
        mockProvider.willDecline();
        var response = subscriptionsPage.create(aSubscription().withPlan("immediate").build());
        String subscriptionId = response.jsonPath().getString("id");

        context.getSubscriptionService().retryPayment(subscriptionId);
        context.getSubscriptionService().retryPayment(subscriptionId);
        context.getSubscriptionService().retryPayment(subscriptionId);

        assertions.assertPersistedStatus(subscriptionId, SubscriptionStatus.CANCELED);
        assertions.assertInvoiceCount(subscriptionId, 3);
        assertThat(mockProvider.callCount()).isEqualTo(3);
    }

    @Test(description = "provider returns failed result on decline with no chargeId")
    public void providerDeclineReturnsFailedResult() {
        mockProvider.willDecline();
        var result = mockProvider.charge("cust_001", "pm_visa", 4900, "inv_001");

        assertThat(result.success()).isFalse();
        assertThat(result.failureReason()).isEqualTo("card_declined");
        assertThat(result.chargeId()).isNull();
    }

    @Test(description = "provider returns success result with chargeId")
    public void providerSucceedReturnsChargeId() {
        mockProvider.willSucceed();
        var result = mockProvider.charge("cust_001", "pm_visa", 4900, "inv_001");

        assertThat(result.success()).isTrue();
        assertThat(result.chargeId()).isNotBlank();
        assertThat(result.failureReason()).isNull();
    }

    @Test(expectedExceptions = PaymentProviderTimeoutException.class,
          description = "provider throws the typed timeout exception")
    public void providerThrowsOnTimeout() {
        mockProvider.willTimeout();
        mockProvider.charge("cust_001", "pm_visa", 4900, "inv_001");
    }

    @Test(description = "provider call count resets correctly between tests")
    public void providerCallCountResetsOnReset() {
        mockProvider.charge("cust_001", "pm_visa", 4900, "inv_001");
        assertThat(mockProvider.callCount()).isEqualTo(1);

        mockProvider.reset();
        assertThat(mockProvider.callCount()).isZero();
    }
}
