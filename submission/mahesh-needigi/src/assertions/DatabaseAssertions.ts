import { expect } from "vitest"
import { BillingDatabase } from "../../fixture/database"

export class DatabaseAssertions {
    constructor(readonly database: BillingDatabase) {}

    verifySubscription(subId: string, expectedStatus: string, expectedPlan?: string) {
        const row: any = this.database.db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subId)
        expect(row.status).toBe(expectedStatus)
        if (expectedPlan) expect(row.plan).toBe(expectedPlan)
    }

    verifyInvoiceCount(subId: string, count: number, status?: string) {
        const rows = status
            ? this.database.db.prepare("SELECT * FROM invoices WHERE subscription_id = ? AND status = ?").all(subId, status)
            : this.database.db.prepare("SELECT * FROM invoices WHERE subscription_id = ?").all(subId)
        expect(rows).toHaveLength(count)
    }

    verifyWebhookResult(eventId: string, expectedResult: string) {
        const row: any = this.database.db.prepare("SELECT * FROM webhook_events WHERE event_id = ?").get(eventId)
        expect(row.processing_result).toBe(expectedResult)
    }

    verifyAuditTrail(subId: string, expectedStates: string[]) {
        const rows: any[] = this.database.db.prepare("SELECT to_state FROM audit_history WHERE subscription_id = ? ORDER BY id ASC").all(subId)
        expect(rows.map((r) => r.to_state)).toEqual(expectedStates)
    }
}
