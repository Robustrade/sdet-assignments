package com.billing.repository;

import com.billing.domain.Invoice;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public class InvoiceRepository {

    private final Map<String, Invoice> store = new HashMap<>();

    public void save(Invoice invoice) {
        store.put(invoice.getId(), invoice);
    }

    public List<Invoice> findBySubscriptionId(String subscriptionId) {
        return store.values().stream()
            .filter(i -> i.getSubscriptionId().equals(subscriptionId))
            .toList();
    }

    public boolean existsById(String id) {
        return store.containsKey(id);
    }

    public Optional<Invoice> findById(String id) {
        return Optional.ofNullable(store.get(id));
    }

    public void clear() {
        store.clear();
    }
}
