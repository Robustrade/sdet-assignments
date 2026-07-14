const db = require("./database");

function seedDatabase() {
    db.serialize(() => {

        // Clear existing data
        db.run("DELETE FROM audit_events");
        db.run("DELETE FROM idempotency_keys");
        db.run("DELETE FROM transfers");
        db.run("DELETE FROM wallets");

        // Insert sample wallets
        db.run(
            `INSERT INTO wallets (id, balance, currency)
             VALUES ('wallet_001', 10000, 'AED')`
        );

        db.run(
            `INSERT INTO wallets (id, balance, currency)
             VALUES ('wallet_002', 5000, 'AED')`
        );

        console.log("Database seeded successfully.");
    });
}

module.exports = seedDatabase;