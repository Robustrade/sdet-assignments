import type { Express } from 'express';
import { FetchTransport, SupertestTransport, type HttpTransport } from './http-transport';
import { SubscriptionApiClient } from './subscription-api-client';
import { WebhookApiClient } from './webhook-api-client';
import type { SignatureVerifier } from '../../../src/services/signature-verifier';

export interface ApiClients {
  transport: HttpTransport;
  subscriptions: SubscriptionApiClient;
  webhooks: WebhookApiClient;
}

/**
 * FACTORY: builds a client set per environment. Today the suite runs in-process
 * (fast, no ports); pointing it at a deployed service is a one-line change here
 * and zero changes in the specs.
 */
export class ApiClientFactory {
  static forInProcessApp(app: Express, signatures: SignatureVerifier): ApiClients {
    return ApiClientFactory.from(new SupertestTransport(app), signatures);
  }

  static forBaseUrl(baseUrl: string, signatures: SignatureVerifier): ApiClients {
    return ApiClientFactory.from(new FetchTransport(baseUrl), signatures);
  }

  private static from(transport: HttpTransport, signatures: SignatureVerifier): ApiClients {
    return {
      transport,
      subscriptions: new SubscriptionApiClient(transport),
      webhooks: new WebhookApiClient(transport, signatures)
    };
  }
}
