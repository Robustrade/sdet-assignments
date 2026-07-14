const db = require("../db/database");

function createAuditEvent(transferId, eventType) {
    return new Promise((resolve, reject) => {

        db.run(
            `
            INSERT INTO audit_events
            (
                transfer_id,
                event_type
            )
            VALUES (?, ?)
            `,
            [transferId, eventType],
            function (err) {

                if (err) {
                    return reject(err);
                }

                resolve(this.lastID);
            }
        );

    });
}

module.exports = {
    createAuditEvent
};