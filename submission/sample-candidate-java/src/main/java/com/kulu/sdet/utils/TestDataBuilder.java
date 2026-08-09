package com.wallet.utils;

import com.wallet.models.TransferRequest;
import java.util.UUID;

public class TestDataBuilder {

    public static TransferRequest buildStandardTransfer(String source, String dest, double amount) {
        return new TransferRequest(
            source, 
            dest, 
            amount, 
            "AED", 
            "INV-" + System.currentTimeMillis()
        );
    }

    public static String generateIdempotencyKey() {
        return UUID.randomUUID().toString();
    }
}