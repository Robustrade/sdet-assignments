/**
 * HMAC-SHA256 webhook signature utility matching X-Provider-Signature contract.
 * Author: Vedant Dalkari
 */

import { createHmac } from 'node:crypto';

export class HmacWebhookSigner {
  public static readonly DEFAULT_SECRET = 'whsec_test_billing_vedant_dalkari';

  private readonly secret: string;

  public constructor(secret: string = HmacWebhookSigner.DEFAULT_SECRET) {
    this.secret = secret;
  }

  public computeDigest(rawBody: string, secretOverride?: string): string {
    const key = secretOverride ?? this.secret;
    return createHmac('sha256', key).update(rawBody, 'utf8').digest('hex');
  }

  public sign(rawBody: string, secretOverride?: string): string {
    return `sha256=${this.computeDigest(rawBody, secretOverride)}`;
  }
}
