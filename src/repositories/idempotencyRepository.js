const db = require("../db/database");

function getByKey(key) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT * FROM idempotency_keys WHERE idempotency_key = ?",
            [key],
            (err, row) => {
                if (err) return reject(err);
                resolve(row);
            }
        );
    });
}

function saveKey(key, transferId) {
    return new Promise((resolve, reject) => {
        db.run(
            `
            INSERT INTO idempotency_keys
            (
                idempotency_key,
                transfer_id
            )
            VALUES (?, ?)
            `,
            [key, transferId],
            function (err) {
                if (err) return reject(err);
                resolve();
            }
        );
    });
}

module.exports = {
    getByKey,
    saveKey
};