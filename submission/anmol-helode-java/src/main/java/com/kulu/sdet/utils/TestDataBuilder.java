package utils;

import java.util.UUID;

public class TestDataBuilder {

    public static String payload(String src, String dest, int amount) {
        return String.format("""
        {
          "source_wallet_id": "%s",
          "destination_wallet_id": "%s",
          "amount": %d,
          "currency": "AED",
          "reference": "%s"
        }
        """, src, dest, amount, UUID.randomUUID());
    }

    public static String key() {
        return UUID.randomUUID().toString();
    }
}