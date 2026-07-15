const express = require("express");
const router = express.Router();

const transferService = require("../services/transferService");

router.post("/", async (req, res) => {

    try {

        const request = {
            ...req.body,
            idempotencyKey: req.header("Idempotency-Key")
        };

        const result =
            await transferService.transferMoney(request);

        res.status(201).json(result);

    } catch (error) {

        res.status(400).json({
            error: error.message
        });

    }

});

module.exports = router;