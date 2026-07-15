const db = require("./database");

function createSchema() {
    return new Promise((resolve, reject) => {

        db.serialize(() => {

            db.run(`
                CREATE TABLE IF NOT EXISTS wallets (
                    id TEXT PRIMARY KEY,
                    balance INTEGER NOT NULL,
                    currency TEXT NOT NULL
                )
            `);

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

            db.run(`
                CREATE TABLE IF NOT EXISTS idempotency_keys (
                    idempotency_key TEXT PRIMARY KEY,
                    transfer_id TEXT NOT NULL
                )
            `);

            db.run(`
                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    transfer_id TEXT,
                    event_type TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {

                if (err) return reject(err);

                resolve();
            });

        });

    });
}

module.exports = createSchema;