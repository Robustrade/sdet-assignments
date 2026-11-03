const nodeCrypto = require('crypto');
const { SubscriptionBuilder: SubscriptionBuilderModule } = require('./SubscriptionBuilder');
const { SubscriptionRepository: SubscriptionRepositoryClass } = require('./SubscriptionRepository');
const { SubscriptionStateMachine: SubscriptionStateMachineClass } = require('./SubscriptionStateMachine');
const { PaymentProviderMock: PaymentProviderMockClass } = require('./PaymentProvider');

class SubscriptionService {
  repository: any;
  paymentProvider: any;
  stateMachine: any;
  webhookSecret: string;
  constructor({ repository, paymentProvider, stateMachine, webhookSecret = 'billing-secret' }: {
    repository?: any;
    paymentProvider?: any;
    stateMachine?: any;
    webhookSecret?: string;
  } = {}) {
    this.repository = repository || new SubscriptionRepositoryClass();
    this.paymentProvider = paymentProvider || new PaymentProviderMockClass();
    this.stateMachine = stateMachine || new SubscriptionStateMachineClass();
    this.webhookSecret = webhookSecret;
  }

  async createSubscription(input: any) {
    const subscription = SubscriptionBuilderModule.createSubscription(input);
    this.repository.saveSubscription(subscription);

    if (subscription.charge_immediately) {
      const invoice = {
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        subscription_id: subscription.id,
        amount: subscription.price,
        currency: subscription.currency,
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      this.repository.saveInvoice(invoice);

      try {
        const result = await this.paymentProvider.charge({
          subscriptionId: subscription.id,
          customerId: subscription.customer_id,
          amount: subscription.price,
          currency: subscription.currency,
          paymentMethodId: subscription.payment_method_id,
        });

        if (result.ok) {
          subscription.state = this.stateMachine.apply(subscription.state, 'payment_succeeded');
          invoice.status = 'paid';
          this.repository.logEvent(subscription.id, {
            event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'payment.succeeded',
            invoice_id: invoice.id,
            amount: subscription.price,
            currency: subscription.currency,
          });
        } else {
          subscription.state = this.stateMachine.apply(subscription.state, 'payment_failed');
          invoice.status = 'failed';
          this.repository.logEvent(subscription.id, {
            event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'payment.failed',
            invoice_id: invoice.id,
            amount: subscription.price,
            currency: subscription.currency,
          });
        }
      } catch (error) {
        subscription.state = this.stateMachine.apply(subscription.state, 'payment_failed');
        invoice.status = 'failed';
        this.repository.logEvent(subscription.id, {
          event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'payment.failed',
          invoice_id: invoice.id,
          amount: subscription.price,
          currency: subscription.currency,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      const invoice = {
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        subscription_id: subscription.id,
        amount: 0,
        currency: subscription.currency,
        status: 'trial',
        created_at: new Date().toISOString(),
      };
      this.repository.saveInvoice(invoice);
      this.repository.logEvent(subscription.id, {
        event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'subscription.created',
        invoice_id: invoice.id,
      });
    }

    return subscription;
  }

  getSubscription(id: string) {
    const subscription = this.repository.getSubscription(id);
    if (!subscription) {
      throw new Error(`Subscription ${id} was not found`);
    }
    return subscription;
  }

  async cancelSubscription(id: string) {
    const subscription = this.getSubscription(id);
    if (subscription.state === 'canceled') {
      return subscription;
    }

    const nextState = this.stateMachine.apply(subscription.state, 'customer_canceled');
    subscription.state = nextState;
    this.repository.logEvent(subscription.id, {
      event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'subscription.canceled',
    });

    return subscription;
  }

  async processWebhook(payload: any, rawBody: string | Buffer, signature?: string) {
    const expectedSignature = this.sign(rawBody);
    if (!signature || signature !== expectedSignature) {
      return { ok: false, status: 401, error: 'Invalid webhook signature' };
    }

    if (!payload || !payload.event_id || !payload.subscription_id || !payload.type) {
      return { ok: false, status: 400, error: 'Malformed webhook payload' };
    }

    const subscription = this.repository.getSubscription(payload.subscription_id);
    if (!subscription) {
      return { ok: false, status: 404, error: 'Unknown subscription' };
    }

    if (this.repository.hasSeenEvent(payload.event_id)) {
      return { ok: true, ignored: true, reason: 'Duplicate webhook event; no-op' };
    }

    if (subscription.state === 'canceled' && payload.type !== 'payment.refunded') {
      return { ok: true, ignored: true, reason: 'Canceled subscriptions do not accept further billing events' };
    }

    let nextState;
    switch (payload.type) {
      case 'payment.succeeded':
        nextState = this.stateMachine.canTransition(subscription.state, 'payment_succeeded')
          ? this.stateMachine.apply(subscription.state, 'payment_succeeded')
          : null;
        break;
      case 'payment.failed':
        nextState = this.stateMachine.canTransition(subscription.state, 'payment_failed')
          ? this.stateMachine.apply(subscription.state, 'payment_failed')
          : null;
        break;
      case 'payment.refunded':
        nextState = 'canceled';
        break;
      default:
        return { ok: false, status: 400, error: `Unsupported event type: ${payload.type}` };
    }

    if (!nextState) {
      return { ok: true, ignored: true, reason: `Illegal transition for ${subscription.state} on ${payload.type}` };
    }

    subscription.state = nextState;
    this.repository.logEvent(subscription.id, {
      event_id: payload.event_id,
      type: payload.type,
      invoice_id: payload.invoice_id,
      amount: payload.amount,
      currency: payload.currency,
    });

    return { ok: true, subscription, ignored: false };
  }

  sign(rawBody: string | Buffer) {
    return nodeCrypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
  }
}

module.exports = {
  SubscriptionService,
  SubscriptionRepository: SubscriptionRepositoryClass,
  SubscriptionStateMachine: SubscriptionStateMachineClass,
  PaymentProviderMock: PaymentProviderMockClass,
};

export {};
