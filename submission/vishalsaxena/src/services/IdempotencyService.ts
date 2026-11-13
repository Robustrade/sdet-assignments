
import { createHash } from 'crypto';
import { IdempotencyRepository } from '../repositories/IdempotencyRepository';

export class IdempotencyService {
  constructor(
    private repository: IdempotencyRepository
  ) {}

  generateRequestHash(payload: unknown): string {
    const normalizedPayload = JSON.stringify(payload);

    return createHash('sha256')
      .update(normalizedPayload)
      .digest('hex');
  }

  checkRequest(
    idempotencyKey: string,
    payload: unknown
  ): {
    isReplay: boolean;
    responseBody?: string;
    responseStatus?: number;
  } {
    if (!idempotencyKey.trim()) {
      throw new Error('Idempotency key is required');
    }

    const requestHash = this.generateRequestHash(payload);
    const existing = this.repository.findByKey(idempotencyKey);

    if (!existing) {
      this.repository.create(idempotencyKey, requestHash);

      return { isReplay: false };
    }

    if (existing.requestHash !== requestHash) {
      throw new Error(
        'Idempotency key reused with a different request payload'
      );
    }

    if (
        existing.responseBody == null ||
        existing.responseStatus == null
      ) {
      throw new Error('Request with this idempotency key is still processing');
    }

    return {
      isReplay: true,
      responseBody: existing.responseBody,
      responseStatus: existing.responseStatus
    };
  }

  saveResponse(
    idempotencyKey: string,
    responseBody: string,
    responseStatus: number
  ): void {
    this.repository.saveResponse(
      idempotencyKey,
      responseBody,
      responseStatus
    );
  }
}
