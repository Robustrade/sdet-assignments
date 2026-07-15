const db = require("./database");

function seedDatabase() {
    return new Promise((resolve, reject) => {

        db.serialize(() => {

            db.run("DELETE FROM audit_events");
            db.run("DELETE FROM idempotency_keys");
            db.run("DELETE FROM transfers");
            db.run("DELETE FROM wallets");

            db.run(`
                INSERT INTO wallets (id, balance, currency)
                VALUES ('wallet_001', 10000, 'AED')
            `);

            db.run(`
                INSERT INTO wallets (id, balance, currency)
                VALUES ('wallet_002', 5000, 'AED')
            `, (err) => {

                if (err) return reject(err);

                resolve();

            });

        });

    });
}

module.exports = seedDatabase;