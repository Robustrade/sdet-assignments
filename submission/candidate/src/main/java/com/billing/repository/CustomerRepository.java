package com.billing.repository;

import java.util.HashSet;
import java.util.Set;

public class CustomerRepository {

    private final Set<String> customerIds = new HashSet<>();

    public void save(String customerId) {
        customerIds.add(customerId);
    }

    public boolean existsById(String customerId) {
        return customerIds.contains(customerId);
    }

    public void clear() {
        customerIds.clear();
    }
}
