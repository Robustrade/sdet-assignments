import { Database } from "better-sqlite3";
import { WebhookEvent } from "../domain/webhook/WebhookEvent";


export class WebhookEventRepository {


    constructor(
        private db: Database
    ) {}



    create(
        event: WebhookEvent
    ) {


        const statement =
            this.db.prepare(`
                INSERT INTO webhook_events
                (
                    event_id,
                    type,
                    subscription_id,
                    processed_at
                )
                VALUES
                (?, ?, ?, ?)
            `);



        statement.run(

            event.eventId,

            event.type,

            event.subscriptionId,

            event.processedAt

        );


        return event;

    }





    exists(
        eventId: string
    ): boolean {


        const result =
            this.db.prepare(`
                SELECT event_id
                FROM webhook_events
                WHERE event_id = ?
            `)
            .get(eventId);



        return Boolean(result);

    }





    findByEventId(
        eventId:string
    ): WebhookEvent | undefined {


        const row:any =
            this.db.prepare(`
                SELECT
                    event_id,
                    type,
                    subscription_id,
                    processed_at
                FROM webhook_events
                WHERE event_id = ?
            `)
            .get(eventId);



        if(!row){

            return undefined;

        }



        return {

            eventId:
                row.event_id,

            type:
                row.type,

            subscriptionId:
                row.subscription_id,

            processedAt:
                row.processed_at

        };

    }




    count(): number {


        const result:any =
            this.db.prepare(`
                SELECT COUNT(*) as count
                FROM webhook_events
            `)
            .get();



        return result.count;

    }

}