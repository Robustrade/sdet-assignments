const express = require("express");

const transferRoutes = require("./routes/transferRoutes");
const walletRoutes = require("./routes/walletRoutes");

const app = express();

app.use(express.json());

app.use("/transfers", transferRoutes);
app.use("/wallets", walletRoutes);

module.exports = app;