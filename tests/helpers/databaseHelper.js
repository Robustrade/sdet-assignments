const db = require("../../src/db/database");

function getWallet(walletId) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT * FROM wallets WHERE id = ?",
            [walletId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row);
            }
        );
    });
}

function getTransfer(transferId) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT * FROM transfers WHERE id = ?",
            [transferId],
            (err, row) => {
                if (err) return reject(err);
                resolve(row);
            }
        );
    });
}

function getAuditEvents(transferId) {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM audit_events WHERE transfer_id = ?",
            [transferId],
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            }
        );
    });
}

module.exports = {
    getWallet,
    getTransfer,
    getAuditEvents
};