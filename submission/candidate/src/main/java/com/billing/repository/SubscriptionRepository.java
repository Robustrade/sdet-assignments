package com.billing.repository;

import com.billing.domain.Subscription;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public class SubscriptionRepository {

    private final Map<String, Subscription> store = new HashMap<>();

    public void save(Subscription subscription) {
        store.put(subscription.getId(), subscription);
    }

    public Optional<Subscription> findById(String id) {
        return Optional.ofNullable(store.get(id));
    }

    public boolean existsById(String id) {
        return store.containsKey(id);
    }

    public int count() {
        return store.size();
    }

    public void clear() {
        store.clear();
    }
}
