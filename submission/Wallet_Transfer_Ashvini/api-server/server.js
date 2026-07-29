const express = require("express");

const app = express();

app.use(express.json());


// Store transfers in memory
let transfers = [];


app.get("/", (req, res) => {
    res.send("Wallet API running");
});


app.post("/transfers", (req, res) => {

    const key = req.headers["idempotency-key"];


    // Validation
    if (!req.body.amount || req.body.amount <= 0) {
        return res.status(400).json({
            error: "Invalid amount"
        });
    }


    // Idempotency check
    const existingTransfer = transfers.find(
        t => t.key === key
    );


    if (existingTransfer) {
        return res.status(201).json(existingTransfer);
    }


    // Create transfer
    const transfer = {

        transfer_id:
            "TRX_" + Date.now(),

        source_wallet_id:
            req.body.source_wallet_id,

        destination_wallet_id:
            req.body.destination_wallet_id,

        amount:
            req.body.amount,

        currency:
            req.body.currency,

        status:
            "COMPLETED",

        key:key
    };


    transfers.push(transfer);


    return res.status(201).json(transfer);

});


app.listen(3000, "127.0.0.1", () => {

    console.log(
        "Wallet API running on port 3000"
    );

});