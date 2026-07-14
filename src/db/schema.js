const db = require("./database");

function createSchema() {
    db.serialize(() => {

        // Wallets table
        db.run(`
            CREATE TABLE IF NOT EXISTS wallets (
                id TEXT PRIMARY KEY,
                balance INTEGER NOT NULL,
                currency TEXT NOT NULL
            )
        `);

        // Transfers table
        db.run(`
            CREATE TABLE IF NOT EXISTS transfers (
                id TEXT PRIMARY KEY,
                source_wallet_id TEXT NOT NULL,
                destination_wallet_id TEXT NOT NULL,
                amount INTEGER NOT NULL,
                currency TEXT NOT NULL,
                reference TEXT,
                status TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Idempotency table
        db.run(`
            CREATE TABLE IF NOT EXISTS idempotency_keys (
                idempotency_key TEXT PRIMARY KEY,
                transfer_id TEXT NOT NULL
            )
        `);

        // Audit table
        db.run(`
            CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transfer_id TEXT,
                event_type TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log("Database schema created successfully.");
    });
}

module.exports = createSchema;