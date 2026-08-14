import { db } from "../database/database";

export class WebhookEventRepository {

    recordEvent(eventId: string, type: string, payload: string) {
        const stmt = db.prepare(`INSERT INTO webhook_events (event_id, type, payload, received_at) VALUES (?, ?, ?, datetime('now'))`);
        stmt.run(eventId, type, payload);
    }

    exists(eventId: string): boolean {
        const stmt = db.prepare(`SELECT 1 FROM webhook_events WHERE event_id = ?`);
        const row = stmt.get(eventId);
        return !!row;
    }

}
