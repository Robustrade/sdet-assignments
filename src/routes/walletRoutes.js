const express = require("express");
const router = express.Router();

const walletRepository =
    require("../repositories/walletRepository");

router.get("/:id", async (req, res) => {

    const wallet =
        await walletRepository.getWalletById(req.params.id);

    if (!wallet) {

        return res.status(404).json({
            error: "Wallet not found"
        });

    }

    res.json(wallet);

});

module.exports = router;