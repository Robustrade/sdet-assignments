package com.billing.mocks;

import com.billing.service.PaymentProvider;
import com.billing.service.PaymentProviderTimeoutException;

import java.util.ArrayList;
import java.util.List;

public class MockPaymentProvider implements PaymentProvider {

    public enum Behavior { SUCCEED, DECLINE, TIMEOUT }

    public record RecordedCall(
        String customerId,
        String paymentMethodId,
        int amountInCents,
        String idempotencyKey
    ) {}

    private Behavior behavior = Behavior.SUCCEED;
    private final List<RecordedCall> calls = new ArrayList<>();

    public void willSucceed() { this.behavior = Behavior.SUCCEED; }
    public void willDecline() { this.behavior = Behavior.DECLINE; }
    public void willTimeout() { this.behavior = Behavior.TIMEOUT; }

    @Override
    public ChargeResult charge(String customerId, String paymentMethodId,
                               int amountInCents, String idempotencyKey) {
        calls.add(new RecordedCall(customerId, paymentMethodId, amountInCents, idempotencyKey));

        return switch (behavior) {
            case SUCCEED -> ChargeResult.succeeded("ch_" + idempotencyKey);
            case DECLINE -> ChargeResult.failed("card_declined");
            case TIMEOUT -> throw new PaymentProviderTimeoutException("Payment provider timeout");
        };
    }

    public int callCount()               { return calls.size(); }
    public List<RecordedCall> getCalls() { return List.copyOf(calls); }
    public RecordedCall lastCall()       { return calls.get(calls.size() - 1); }

    public void reset() {
        calls.clear();
        behavior = Behavior.SUCCEED;
    }
}
