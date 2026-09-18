import type { DatabaseSync } from 'node:sqlite';

export interface ReconciliationRecord {
    id?: number;
    providerPaymentId: string;
    correlationId: string;
    errorMessage: string;
    createdAt: string;
}

export class ReconciliationRepository {
    constructor(private readonly db: DatabaseSync) {}

    create(record: ReconciliationRecord): void {
        this.db.prepare(`
            INSERT INTO reconciliation_events (
                provider_payment_id,
                correlation_id,
                error_message,
                created_at
            )
            VALUES (?, ?, ?, ?)
        `).run(
            record.providerPaymentId,
            record.correlationId,
            record.errorMessage,
            record.createdAt,
        );
    }

    getByProviderPaymentId(providerPaymentId: string): ReconciliationRecord[] {
        const rows = this.db.prepare(`
            SELECT
                id,
                provider_payment_id,
                correlation_id,
                error_message,
                created_at
            FROM reconciliation_events
            WHERE provider_payment_id = ?
            ORDER BY id ASC
        `).all(providerPaymentId) as Array<{
            id: number;
            provider_payment_id: string;
            correlation_id: string;
            error_message: string;
            created_at: string;
        }>;

        return rows.map((row) => ({
            id: row.id,
            providerPaymentId: row.provider_payment_id,
            correlationId: row.correlation_id,
            errorMessage: row.error_message,
            createdAt: row.created_at,
        }));
    }
}