package com.billing.service;

import com.billing.domain.IllegalStateTransitionException;
import com.billing.domain.Invoice;
import com.billing.domain.Plan;
import com.billing.domain.Subscription;
import com.billing.domain.SubscriptionStateMachine;
import com.billing.domain.SubscriptionStatus;
import com.billing.domain.WebhookEvent;
import com.billing.repository.InvoiceRepository;
import com.billing.repository.CustomerRepository;
import com.billing.repository.SubscriptionRepository;
import com.billing.repository.WebhookEventRepository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public class SubscriptionService {

    private static final long MAX_FAILED_PAYMENT_ATTEMPTS = 3;

    private final SubscriptionRepository subscriptions;
    private final InvoiceRepository invoices;
    private final WebhookEventRepository webhookEvents;
    private final CustomerRepository customers;
    private final PaymentProvider paymentProvider;
    private final SubscriptionStateMachine stateMachine;

    public SubscriptionService(SubscriptionRepository subscriptions,
                               InvoiceRepository invoices,
                               WebhookEventRepository webhookEvents,
                               CustomerRepository customers,
                               PaymentProvider paymentProvider) {
        this.subscriptions = subscriptions;
        this.invoices = invoices;
        this.webhookEvents = webhookEvents;
        this.customers = customers;
        this.paymentProvider = paymentProvider;
        this.stateMachine = new SubscriptionStateMachine();
    }

    public synchronized Subscription create(String customerId, Plan plan, String paymentMethodId) {
        if (!customers.existsById(customerId)) {
            throw new NotFoundException("Customer not found: " + customerId);
        }
        String id = "sub_" + shortId();
        Subscription sub = new Subscription(id, customerId, plan, paymentMethodId, plan.initialStatus());

        if (plan.getTrialDays() == 0) {
            String invoiceId = "inv_" + shortId();
            Invoice invoice = chargeInvoice(sub, invoiceId);
            SubscriptionStatus status = invoice.getStatus() == Invoice.Status.PAID
                ? SubscriptionStatus.ACTIVE : SubscriptionStatus.PAST_DUE;
            sub.applyStatus(status, stateMachine);
            invoices.save(invoice);
        }
        subscriptions.save(sub);
        return sub;
    }

    public synchronized Subscription get(String id) {
        return subscriptions.findById(id)
            .orElseThrow(() -> new NotFoundException("Subscription not found: " + id));
    }

    public synchronized Subscription cancel(String id) {
        Subscription sub = get(id);
        sub.applyStatus(SubscriptionStatus.CANCELED, stateMachine);
        subscriptions.save(sub);
        return sub;
    }

    public synchronized Subscription retryPayment(String subscriptionId) {
        Subscription sub = get(subscriptionId);
        if (sub.getStatus() != SubscriptionStatus.PAST_DUE) {
            return sub;
        }

        List<Invoice> existingInvoices = invoices.findBySubscriptionId(subscriptionId);
        if (existingInvoices.stream().anyMatch(invoice -> invoice.getStatus() == Invoice.Status.PENDING)) {
            return sub;
        }
        if (countConsecutiveFailedAttempts(subscriptionId) >= MAX_FAILED_PAYMENT_ATTEMPTS) {
            sub.applyStatus(SubscriptionStatus.CANCELED, stateMachine);
            subscriptions.save(sub);
            return sub;
        }

        Invoice invoice = chargeInvoice(sub, "inv_" + shortId());
        invoices.save(invoice);
        if (invoice.getStatus() == Invoice.Status.PAID) {
            sub.applyStatus(SubscriptionStatus.ACTIVE, stateMachine);
        } else if (invoice.getStatus() == Invoice.Status.FAILED
            && countConsecutiveFailedAttempts(subscriptionId) >= MAX_FAILED_PAYMENT_ATTEMPTS) {
            sub.applyStatus(SubscriptionStatus.CANCELED, stateMachine);
        }
        subscriptions.save(sub);
        return sub;
    }

    public synchronized void handleWebhook(WebhookPayload payload) {
        if (webhookEvents.existsById(payload.eventId())) {
            return;
        }

        Subscription sub = subscriptions.findById(payload.subscriptionId()).orElse(null);
        if (sub == null) {
            recordEvent(payload, false);
            return;
        }

        boolean processed = switch (payload.type()) {
            case "payment.succeeded" -> handleSucceeded(sub, payload);
            case "payment.failed"    -> handleFailed(sub, payload);
            case "payment.refunded"  -> handleRefunded(sub, payload);
            default                  -> false;
        };

        recordEvent(payload, processed);
    }

    private boolean handleSucceeded(Subscription sub, WebhookPayload payload) {
        Invoice existingInvoice = invoices.findById(payload.invoiceId()).orElse(null);
        if (!belongsToSubscription(existingInvoice, sub)
            || !hasExpectedAmount(existingInvoice, sub, payload)) {
            return false;
        }
        if (existingInvoice != null && (existingInvoice.getStatus() == Invoice.Status.PAID
            || existingInvoice.getStatus() == Invoice.Status.REFUNDED)) {
            return false;
        }
        if (sub.getStatus() != SubscriptionStatus.ACTIVE) {
            if (!stateMachine.canTransition(sub.getStatus(), SubscriptionStatus.ACTIVE)) {
                return false;
            }
            sub.applyStatus(SubscriptionStatus.ACTIVE, stateMachine);
            subscriptions.save(sub);
        }
        invoices.save(new Invoice(payload.invoiceId(), sub.getId(),
            payload.amount(), Invoice.Status.PAID));
        return true;
    }

    private boolean handleFailed(Subscription sub, WebhookPayload payload) {
        Invoice existingInvoice = invoices.findById(payload.invoiceId()).orElse(null);
        if (!belongsToSubscription(existingInvoice, sub)
            || !hasExpectedAmount(existingInvoice, sub, payload)) {
            return false;
        }
        if (existingInvoice != null && (existingInvoice.getStatus() == Invoice.Status.PAID
            || existingInvoice.getStatus() == Invoice.Status.REFUNDED
            || existingInvoice.getStatus() == Invoice.Status.FAILED)) {
            return false;
        }
        if (sub.getStatus() != SubscriptionStatus.PAST_DUE) {
            if (!stateMachine.canTransition(sub.getStatus(), SubscriptionStatus.PAST_DUE)) {
                return false;
            }
            sub.applyStatus(SubscriptionStatus.PAST_DUE, stateMachine);
        }
        subscriptions.save(sub);
        invoices.save(new Invoice(payload.invoiceId(), sub.getId(),
            payload.amount(), Invoice.Status.FAILED));

        if (countConsecutiveFailedAttempts(sub.getId()) >= MAX_FAILED_PAYMENT_ATTEMPTS) {
            sub.applyStatus(SubscriptionStatus.CANCELED, stateMachine);
            subscriptions.save(sub);
        }
        return true;
    }

    private boolean belongsToSubscription(Invoice invoice, Subscription subscription) {
        return invoice == null || invoice.getSubscriptionId().equals(subscription.getId());
    }

    private Invoice chargeInvoice(Subscription sub, String invoiceId) {
        Invoice.Status status;
        try {
            PaymentProvider.ChargeResult result = paymentProvider.charge(
                sub.getCustomerId(), sub.getPaymentMethodId(),
                sub.getPlan().getPriceInCents(), invoiceId);
            status = result.success() ? Invoice.Status.PAID : Invoice.Status.FAILED;
        } catch (PaymentProviderTimeoutException e) {
            status = Invoice.Status.PENDING;
        }
        return new Invoice(invoiceId, sub.getId(), sub.getPlan().getPriceInCents(), status);
    }

    private boolean hasExpectedAmount(Invoice invoice, Subscription subscription,
                                      WebhookPayload payload) {
        int expectedAmount = invoice == null
            ? subscription.getPlan().getPriceInCents()
            : invoice.getAmountInCents();
        return payload.amount() == expectedAmount;
    }

    private long countConsecutiveFailedAttempts(String subscriptionId) {
        List<Invoice> subscriptionInvoices = invoices.findBySubscriptionId(subscriptionId);
        Instant latestSuccessfulPayment = subscriptionInvoices.stream()
            .filter(invoice -> invoice.getStatus() == Invoice.Status.PAID
                || invoice.getStatus() == Invoice.Status.REFUNDED)
            .map(Invoice::getCreatedAt)
            .max(Instant::compareTo)
            .orElse(null);

        return subscriptionInvoices.stream()
            .filter(invoice -> invoice.getStatus() == Invoice.Status.FAILED)
            .filter(invoice -> latestSuccessfulPayment == null
                || invoice.getCreatedAt().isAfter(latestSuccessfulPayment))
            .count();
    }

    private boolean handleRefunded(Subscription sub, WebhookPayload payload) {
        Invoice invoice = invoices.findById(payload.invoiceId()).orElse(null);
        if (invoice == null || invoice.getStatus() != Invoice.Status.PAID
            || !belongsToSubscription(invoice, sub)
            || !hasExpectedAmount(invoice, sub, payload)) {
            return false;
        }
        invoices.save(invoice.withStatus(Invoice.Status.REFUNDED));
        if (sub.getStatus() == SubscriptionStatus.ACTIVE) {
            sub.applyStatus(SubscriptionStatus.PAST_DUE, stateMachine);
            subscriptions.save(sub);
        }
        return true;
    }

    private void recordEvent(WebhookPayload payload, boolean processed) {
        webhookEvents.save(new WebhookEvent(
            payload.eventId(), payload.type(),
            payload.subscriptionId(), payload.invoiceId(), processed));
    }

    public synchronized List<Invoice> getInvoices(String subscriptionId) {
        return invoices.findBySubscriptionId(subscriptionId);
    }

    public synchronized List<WebhookEvent> getWebhookEvents(String subscriptionId) {
        return webhookEvents.findBySubscriptionId(subscriptionId);
    }

    private String shortId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }
}
