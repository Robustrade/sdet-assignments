
import Database from 'better-sqlite3';

export class WebhookEventRepository {
    constructor(private readonly db: Database.Database) {}

    /**
     * Records a webhook event if it has not already been processed.
     * Returns true for a new event and false for a duplicate.
     */
    recordIfNew(eventId: string, eventType: string): boolean {
        if (!eventId || !eventType) {
            throw new Error('Event ID and event type are required');
        }

        const result = this.db.prepare(`
            INSERT OR IGNORE INTO processed_webhook_events
            (event_id, event_type, processed_at)
            VALUES (?, ?, ?)
        `).run(eventId, eventType, new Date().toISOString());

        return result.changes === 1;
    }

    hasProcessed(eventId: string): boolean {
        const row = this.db.prepare(`
            SELECT 1
            FROM processed_webhook_events
            WHERE event_id = ?
        `).get(eventId);

        return row !== undefined;
    }
    runInTransaction<T>(operation: () => T): T {
        return this.db.transaction(operation)();
    }
}
