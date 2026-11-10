package com.billing.repository;

import com.billing.domain.WebhookEvent;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class WebhookEventRepository {

    private final Map<String, WebhookEvent> store = new HashMap<>();

    public void save(WebhookEvent event) {
        store.put(event.getEventId(), event);
    }

    public boolean existsById(String eventId) {
        return store.containsKey(eventId);
    }

    public List<WebhookEvent> findBySubscriptionId(String subscriptionId) {
        return store.values().stream()
            .filter(e -> e.getSubscriptionId().equals(subscriptionId))
            .toList();
    }

    public void clear() {
        store.clear();
    }
}
