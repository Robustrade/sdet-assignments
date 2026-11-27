/**
 * Fluent builder for signed, malformed, or tampered inbound provider webhooks.
 * Author: Vedant Dalkari
 */

import { HmacWebhookSigner } from '../doubles/HmacWebhookSigner.js';

export interface BuiltWebhookRequest {
  readonly rawBody: string;
  readonly headers: Record<string, string>;
  readonly payload: Record<string, unknown>;
}

export class SignedWebhookBuilder {
  private eventId = 'evt_default_001';
  private eventType: string = 'payment.succeeded';
  private subscriptionId = 'sub_001';
  private invoiceId: string | undefined = 'inv_001';
  private amount: unknown = 1900;
  private currency = 'USD';
  private extraFields: Record<string, unknown> = {};
  private omittedFields = new Set<string>();
  private prettySpaces: number | undefined;
  private rawBodyOverride: string | undefined;
  private postSignMutator: ((raw: string) => string) | undefined;
  private signingSecret = HmacWebhookSigner.DEFAULT_SECRET;
  private signatureOverride: string | undefined;
  private omitSignature = false;

  public static create(): SignedWebhookBuilder {
    return new SignedWebhookBuilder();
  }

  public withEventId(eventId: string): this {
    this.eventId = eventId;
    return this;
  }

  public withType(type: string): this {
    this.eventType = type;
    return this;
  }

  public paymentSucceeded(): this {
    this.eventType = 'payment.succeeded';
    return this;
  }

  public paymentFailed(): this {
    this.eventType = 'payment.failed';
    return this;
  }

  public paymentRefunded(): this {
    this.eventType = 'payment.refunded';
    return this;
  }

  public forSubscription(subscriptionId: string): this {
    this.subscriptionId = subscriptionId;
    return this;
  }

  public forInvoice(invoiceId: string): this {
    this.invoiceId = invoiceId;
    return this;
  }

  public withAmountCents(amount: unknown): this {
    this.amount = amount;
    return this;
  }

  public withCurrency(currency: string): this {
    this.currency = currency;
    return this;
  }

  public withoutField(field: string): this {
    this.omittedFields.add(field);
    return this;
  }

  public withExtraFields(fields: Record<string, unknown>): this {
    this.extraFields = { ...this.extraFields, ...fields };
    return this;
  }

  public withPrettyFormatting(spaces: number = 2): this {
    this.prettySpaces = spaces;
    return this;
  }

  public withRawBodyOverride(rawBody: string): this {
    this.rawBodyOverride = rawBody;
    return this;
  }

  public withTamperedBodyAfterSigning(mutator: (signedRawBody: string) => string): this {
    this.postSignMutator = mutator;
    return this;
  }

  public withWrongSecret(secret: string = 'whsec_wrong_secret'): this {
    this.signingSecret = secret;
    return this;
  }

  public withSignatureOverride(signatureHeader: string): this {
    this.signatureOverride = signatureHeader;
    return this;
  }

  public withoutSignature(): this {
    this.omitSignature = true;
    return this;
  }

  public buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      event_id: this.eventId,
      type: this.eventType,
      subscription_id: this.subscriptionId,
      invoice_id: this.invoiceId,
      amount: this.amount,
      currency: this.currency,
      ...this.extraFields,
    };
    for (const key of this.omittedFields) {
      delete payload[key];
    }
    return payload;
  }

  public buildSignedRequest(signer: HmacWebhookSigner = new HmacWebhookSigner()): BuiltWebhookRequest {
    const payload = this.buildPayload();
    const initialRawBody =
      this.rawBodyOverride !== undefined
        ? this.rawBodyOverride
        : JSON.stringify(payload, null, this.prettySpaces);

    const signature =
      this.signatureOverride !== undefined
        ? this.signatureOverride
        : signer.sign(initialRawBody, this.signingSecret);

    const finalRawBody = this.postSignMutator ? this.postSignMutator(initialRawBody) : initialRawBody;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (!this.omitSignature) {
      headers['x-provider-signature'] = signature;
    }

    return {
      rawBody: finalRawBody,
      headers,
      payload,
    };
  }
}
