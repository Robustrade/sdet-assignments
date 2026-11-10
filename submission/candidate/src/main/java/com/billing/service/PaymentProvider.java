package com.billing.service;

public interface PaymentProvider {

    ChargeResult charge(String customerId, String paymentMethodId,
                        int amountInCents, String idempotencyKey);

    record ChargeResult(boolean success, String chargeId, String failureReason) {

        public static ChargeResult succeeded(String chargeId) {
            return new ChargeResult(true, chargeId, null);
        }

        public static ChargeResult failed(String reason) {
            return new ChargeResult(false, null, reason);
        }
    }
}
