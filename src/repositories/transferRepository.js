const db = require("../db/database");

function createTransfer(transfer) {
    return new Promise((resolve, reject) => {
        db.run(
            `
            INSERT INTO transfers
            (
                id,
                source_wallet_id,
                destination_wallet_id,
                amount,
                currency,
                reference,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                transfer.id,
                transfer.sourceWalletId,
                transfer.destinationWalletId,
                transfer.amount,
                transfer.currency,
                transfer.reference,
                transfer.status
            ],
            function (err) {
                if (err) {
                    return reject(err);
                }

                resolve(transfer);
            }
        );
    });
}

function getTransferById(id) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT * FROM transfers WHERE id = ?",
            [id],
            (err, row) => {
                if (err) {
                    return reject(err);
                }

                resolve(row);
            }
        );
    });
}

module.exports = {
    createTransfer,
    getTransferById
};