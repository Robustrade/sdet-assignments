package com.billing.context;

import com.billing.api.BillingServer;
import com.billing.mocks.MockPaymentProvider;
import com.billing.repository.InvoiceRepository;
import com.billing.repository.CustomerRepository;
import com.billing.repository.SubscriptionRepository;
import com.billing.repository.WebhookEventRepository;
import com.billing.service.SubscriptionService;
import com.billing.service.WebhookSignatureVerifier;

public class AppContext {

    private static AppContext instance;

    public static final int PORT = 7070;
    public static final String BASE_URL = "http://localhost:" + PORT;
    public static final String WEBHOOK_SECRET = "test-secret";

    private final BillingServer server;
    private final SubscriptionRepository subscriptionRepository;
    private final InvoiceRepository invoiceRepository;
    private final WebhookEventRepository webhookEventRepository;
    private final CustomerRepository customerRepository;
    private final MockPaymentProvider mockPaymentProvider;
    private final WebhookSignatureVerifier signatureVerifier;
    private final SubscriptionService subscriptionService;

    private AppContext() {
        subscriptionRepository = new SubscriptionRepository();
        invoiceRepository      = new InvoiceRepository();
        webhookEventRepository = new WebhookEventRepository();
        customerRepository     = new CustomerRepository();
        mockPaymentProvider    = new MockPaymentProvider();
        signatureVerifier      = new WebhookSignatureVerifier(WEBHOOK_SECRET);

        subscriptionService = new SubscriptionService(
            subscriptionRepository,
            invoiceRepository,
            webhookEventRepository,
            customerRepository,
            mockPaymentProvider
        );

        server = new BillingServer(subscriptionService, signatureVerifier);
        server.start(PORT);

        Runtime.getRuntime().addShutdownHook(new Thread(server::stop));
    }

    public static synchronized AppContext getInstance() {
        if (instance == null) {
            instance = new AppContext();
        }
        return instance;
    }

    public MockPaymentProvider getMockPaymentProvider()       { return mockPaymentProvider; }
    public SubscriptionRepository getSubscriptionRepository() { return subscriptionRepository; }
    public InvoiceRepository getInvoiceRepository()           { return invoiceRepository; }
    public WebhookEventRepository getWebhookEventRepository() { return webhookEventRepository; }
    public CustomerRepository getCustomerRepository()         { return customerRepository; }
    public WebhookSignatureVerifier getSignatureVerifier()    { return signatureVerifier; }
    public SubscriptionService getSubscriptionService()       { return subscriptionService; }

    public void reset() {
        subscriptionRepository.clear();
        invoiceRepository.clear();
        webhookEventRepository.clear();
        customerRepository.clear();
        customerRepository.save("cust_001");
        mockPaymentProvider.reset();
    }
}
