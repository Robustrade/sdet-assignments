import type { DatabaseSync } from 'node:sqlite';

export type IdempotencyKeyStatus = 'pending' | 'complete';

export interface IdempotencyKeyRecord {
    key: string;
    subscriptionId: string | null;
    responseStatus: number | null;
    responseBody: string | null;
    status: IdempotencyKeyStatus;
    createdAt: string;
}

export class IdempotencyKeyRepository {
    constructor(private readonly db: DatabaseSync) { }

    claim(
        key: string,
        createdAt: string,
    ): boolean {
        try {
            this.db
                .prepare(`
                    INSERT INTO idempotency_keys (
                        key,
                        subscription_id,
                        response_status,
                        response_body,
                        status,
                        created_at
                    )
                    VALUES (?, NULL, NULL, NULL, 'pending', ?)
                `)
                .run(key, createdAt);

            return true;
        } catch (error) {
            if (this.isUniqueConstraintError(error)) {
                return false;
            }

            throw error;
        }
    }

    getByKey(
        key: string,
    ): IdempotencyKeyRecord | undefined {
        const row = this.db
            .prepare(`
                SELECT
                    key,
                    subscription_id,
                    response_status,
                    response_body,
                    status,
                    created_at
                FROM idempotency_keys
                WHERE key = ?
            `)
            .get(key) as
            | {
                key: string;
                subscription_id: string | null;
                response_status: number | null;
                response_body: string | null;
                status: IdempotencyKeyStatus;
                created_at: string;
            }
            | undefined;

        if (!row) {
            return undefined;
        }

        return {
            key: row.key,
            subscriptionId: row.subscription_id,
            responseStatus: row.response_status,
            responseBody: row.response_body,
            status: row.status,
            createdAt: row.created_at,
        };
    }

    complete(
        key: string,
        subscriptionId: string,
        responseStatus: number,
        responseBody: string,
    ): void {
        const result = this.db
            .prepare(`
                UPDATE idempotency_keys
                SET
                    subscription_id = ?,
                    response_status = ?,
                    response_body = ?,
                    status = 'complete'
                WHERE key = ?
                  AND status = 'pending'
            `)
            .run(
                subscriptionId,
                responseStatus,
                responseBody,
                key,
            );

        if (result.changes !== 1) {
            throw new Error(
                `Cannot complete idempotency key "${key}": key does not exist or is not pending`,
            );
        }
    }

    release(key: string): void {
        this.db
            .prepare(`
                DELETE FROM idempotency_keys
                WHERE key = ?
                  AND status = 'pending'
            `)
            .run(key);
    }

    private isUniqueConstraintError(error: unknown): boolean {
        return (
            error instanceof Error &&
            error.message.includes('UNIQUE constraint failed')
        );
    }
}