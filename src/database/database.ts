import Database from "better-sqlite3";


export class DatabaseConnection {


    private db: Database.Database;



    constructor() {

        this.db =
            new Database(":memory:");

        this.createTables();

    }





    getConnection(): Database.Database {

        return this.db;

    }





    private createTables(): void {


        this.db.exec(`


            CREATE TABLE subscriptions (

                id TEXT PRIMARY KEY,

                customer_id TEXT NOT NULL,

                plan TEXT NOT NULL,

                status TEXT NOT NULL,

                created_at TEXT NOT NULL

            );




            CREATE TABLE invoices (

                id TEXT PRIMARY KEY,

                subscription_id TEXT NOT NULL,

                amount INTEGER NOT NULL,

                status TEXT NOT NULL,

                created_at TEXT NOT NULL

            );




            CREATE TABLE webhook_events (

                event_id TEXT PRIMARY KEY,

                type TEXT NOT NULL,

                subscription_id TEXT NOT NULL,

                processed_at TEXT NOT NULL

            );




            CREATE TABLE audit_logs (

                id TEXT PRIMARY KEY,

                subscription_id TEXT NOT NULL,

                from_state TEXT,

                to_state TEXT NOT NULL,

                event TEXT NOT NULL,

                created_at TEXT NOT NULL

            );


        `);

    }

}