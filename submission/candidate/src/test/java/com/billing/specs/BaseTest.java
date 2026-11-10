package com.billing.specs;

import com.billing.assertions.SubscriptionAssertions;
import com.billing.context.AppContext;
import com.billing.mocks.MockPaymentProvider;
import com.billing.mocks.WebhookSimulator;
import com.billing.pages.SubscriptionsPage;
import com.billing.pages.WebhooksPage;
import org.testng.annotations.BeforeMethod;

public abstract class BaseTest {

    protected AppContext context;
    protected SubscriptionsPage subscriptionsPage;
    protected WebhooksPage webhooksPage;
    protected SubscriptionAssertions assertions;
    protected MockPaymentProvider mockProvider;

    @BeforeMethod
    public void setUp() {
        context = AppContext.getInstance();
        context.reset();

        WebhookSimulator simulator = new WebhookSimulator(context.getSignatureVerifier());

        subscriptionsPage = new SubscriptionsPage();
        webhooksPage      = new WebhooksPage(simulator);
        mockProvider      = context.getMockPaymentProvider();
        assertions        = new SubscriptionAssertions(
            context.getSubscriptionRepository(),
            context.getInvoiceRepository(),
            context.getWebhookEventRepository()
        );
    }
}
