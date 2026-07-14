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

module.exports = {
    getWalletById,
    updateBalance
};