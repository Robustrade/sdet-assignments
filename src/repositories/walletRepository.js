const db = require("../db/database");

function getWalletById(id) {
    return new Promise((resolve, reject) => {
        db.get(
            "SELECT * FROM wallets WHERE id = ?",
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

function updateBalance(id, balance) {
    return new Promise((resolve, reject) => {
        db.run(
            "UPDATE wallets SET balance = ? WHERE id = ?",
            [balance, id],
            function (err) {
                if (err) {
                    return reject(err);
                }
                resolve(this.changes);
            }
        );
    });
}



function updateBalances(sourceWalletId, sourceBalance, destinationWalletId, destinationBalance) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(
                "UPDATE wallets SET balance = ? WHERE id = ?",
                [sourceBalance, sourceWalletId]
            );

            db.run(
                "UPDATE wallets SET balance = ? WHERE id = ?",
                [destinationBalance, destinationWalletId],
                function (err) {
                    if (err) {
                        return reject(err);
                    }

                    resolve();
                }
            );
        });
    });
}

function getAllWallets() {
    return new Promise((resolve, reject) => {
        db.all(
            "SELECT * FROM wallets",
            [],
            (err, rows) => {
                if (err) {
                    return reject(err);
                }

                resolve(rows);
            }
        );
    });
}

module.exports = {
    getWalletById,
    getAllWallets,
    updateBalance,
    updateBalances
};