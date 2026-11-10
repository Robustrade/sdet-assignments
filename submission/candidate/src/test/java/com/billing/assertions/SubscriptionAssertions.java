package com.billing.assertions;

import com.billing.domain.Invoice;
import com.billing.domain.Subscription;
import com.billing.domain.SubscriptionStatus;
import com.billing.repository.InvoiceRepository;
import com.billing.repository.SubscriptionRepository;
import com.billing.repository.WebhookEventRepository;
import io.restassured.response.Response;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

public class SubscriptionAssertions {

    private final SubscriptionRepository subscriptionRepo;
    private final InvoiceRepository invoiceRepo;
    private final WebhookEventRepository webhookEventRepo;

    public SubscriptionAssertions(SubscriptionRepository subscriptionRepo,
                                  InvoiceRepository invoiceRepo,
                                  WebhookEventRepository webhookEventRepo) {
        this.subscriptionRepo = subscriptionRepo;
        this.invoiceRepo = invoiceRepo;
        this.webhookEventRepo = webhookEventRepo;
    }

    public void assertCreated(Response response) {
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(response.jsonPath().getString("id")).isNotBlank();
        assertThat(response.jsonPath().getString("status")).isNotBlank();
    }

    public void assertHttpStatus(Response response, int expected) {
        assertThat(response.statusCode()).isEqualTo(expected);
    }

    public void assertApiStatus(Response response, String expectedStatus) {
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.jsonPath().getString("status")).isEqualTo(expectedStatus);
    }

    public void assertErrorContains(Response response, int httpStatus, String fragment) {
        assertThat(response.statusCode()).isEqualTo(httpStatus);
        assertThat(response.jsonPath().getString("error")).containsIgnoringCase(fragment);
    }

    public Subscription assertPersistedStatus(String id, SubscriptionStatus expected) {
        Subscription sub = subscriptionRepo.findById(id)
            .orElseThrow(() -> new AssertionError("Subscription not found in store: " + id));
        assertThat(sub.getStatus()).as("Persisted status for " + id).isEqualTo(expected);
        return sub;
    }

    public void assertInvoiceCount(String subscriptionId, int expected) {
        assertThat(invoiceRepo.findBySubscriptionId(subscriptionId))
            .as("Invoice count for " + subscriptionId)
            .hasSize(expected);
    }

    public void assertHasPaidInvoice(String subscriptionId) {
        List<Invoice> inv = invoiceRepo.findBySubscriptionId(subscriptionId);
        assertThat(inv).anyMatch(i -> i.getStatus() == Invoice.Status.PAID);
    }

    public void assertNoPaidInvoice(String subscriptionId) {
        List<Invoice> inv = invoiceRepo.findBySubscriptionId(subscriptionId);
        assertThat(inv).noneMatch(i -> i.getStatus() == Invoice.Status.PAID);
    }

    public void assertWebhookEventRecorded(String eventId) {
        assertThat(webhookEventRepo.existsById(eventId))
            .as("Webhook event " + eventId + " should be recorded")
            .isTrue();
    }

    public void assertWebhookEventCount(String subscriptionId, int expected) {
        assertThat(webhookEventRepo.findBySubscriptionId(subscriptionId))
            .as("Webhook event count for " + subscriptionId)
            .hasSize(expected);
    }
}
