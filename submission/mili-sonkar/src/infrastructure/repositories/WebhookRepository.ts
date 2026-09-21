import type { DatabaseSync } from 'node:sqlite';

export type WebhookProcessingStatus =
    | 'processing'
    | 'processed'
    | 'duplicate'
    | 'failed';

export interface WebhookEventRecord {
    eventId: string;
    eventType: string;
    processingStatus: WebhookProcessingStatus;
}

export class WebhookRepository {
    constructor(private readonly db: DatabaseSync) { }

    /**
     * Atomically claims a webhook event for processing.
     *
     * The UNIQUE constraint on event_id is deliberately used as
     * the concurrency boundary. We do not SELECT first and then INSERT.
     */
    tryClaim(
        eventId: string,
        eventType: string,
    ): boolean {
        try {
            this.db
                .prepare(`
          INSERT INTO webhook_events (
            event_id,
            event_type,
            processing_status
          )
          VALUES (?, ?, 'processing')
        `)
                .run(eventId, eventType);

            return true;
        } catch (error) {
            if (this.isUniqueConstraintViolation(error)) {
                const result = this.db
                    .prepare(`
                        UPDATE webhook_events
                        SET
                            event_type = ?,
                            processing_status = 'processing'
                        WHERE event_id = ?
                          AND processing_status = 'failed'
                    `)
                    .run(eventType, eventId);

                return result.changes === 1;
            }

            throw error;
        }
    }

    /**
     * Read-only inspection helper.
     *
     * Production duplicate protection must use tryClaim().
     */
    exists(eventId: string): boolean {
        const row = this.db
            .prepare(`
        SELECT event_id
        FROM webhook_events
        WHERE event_id = ?
        LIMIT 1
      `)
            .get(eventId) as { event_id?: string } | undefined;

        return row !== undefined;
    }

    getById(eventId: string): WebhookEventRecord | undefined {
        const row = this.db
            .prepare(`
        SELECT
          event_id,
          event_type,
          processing_status
        FROM webhook_events
        WHERE event_id = ?
      `)
            .get(eventId) as
            | {
                event_id: string;
                event_type: string;
                processing_status: WebhookProcessingStatus;
            }
            | undefined;

        if (!row) {
            return undefined;
        }

        return {
            eventId: row.event_id,
            eventType: row.event_type,
            processingStatus: row.processing_status,
        };
    }

    markProcessed(eventId: string): void {
        this.db
            .prepare(`
        UPDATE webhook_events
        SET processing_status = 'processed'
        WHERE event_id = ?
      `)
            .run(eventId);
    }

    markFailed(eventId: string): void {
        this.db
            .prepare(`
        UPDATE webhook_events
        SET processing_status = 'failed'
        WHERE event_id = ?
      `)
            .run(eventId);
    }

    markDuplicate(eventId: string): void {
        this.db
            .prepare(`
        UPDATE webhook_events
        SET processing_status = 'duplicate'
        WHERE event_id = ?
      `)
            .run(eventId);
    }

    private isUniqueConstraintViolation(error: unknown): boolean {
        return (
            error instanceof Error &&
            error.message.includes('UNIQUE constraint failed')
        );
    }
}