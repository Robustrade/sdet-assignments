import express from "express";
import subscriptionRouter from "./api/subscription.routes";

const app = express();

app.use(express.json());
app.use(subscriptionRouter);

export { app };