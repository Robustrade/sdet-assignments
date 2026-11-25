import { SignatureValidator }
from "./webhook/SignatureValidator";

import express from "express";

import { repositoryContainer }
from "./repositories/RepositoryContainer";

import { SubscriptionStatus }
from "./domain/SubscriptionStatus";

const app = express();
const validator =
  new SignatureValidator();

app.use(express.json());

app.get("/health", (_req, res) => {

  res.status(200).json({
    status: "ok"
  });

});

app.post(
  "/subscriptions",
  (req, res) => {

    const {
      customerId,
      plan
    } = req.body;

    if (
      !customerId ||
      !plan
    ) {
      return res
        .status(400)
        .json({
          error:
            "Missing fields"
        });
    }

    const subscription = {
      id:
        `sub_${Date.now()}`,

      customerId,

      plan,

      status:
        SubscriptionStatus
          .TRIALING
    };

    repositoryContainer
      .subscriptions
      .save(subscription);

    return res
      .status(201)
      .json(subscription);

  }
);
app.post(
  "/webhooks/payment-provider",
  (req, res) => {

    const signature =
      req.header(
        "X-Provider-Signature"
      );

    const valid =
      validator.validate(
        signature
      );

    if (!valid) {

      return res
        .status(401)
        .json({
          error:
            "Invalid signature"
        });

    }

    return res
      .status(200)
      .json({
        accepted: true
      });

  }
);

export default app;