import request
from "supertest";

import {
  describe,
  expect,
  test
} from "vitest";

import app
from "../../src/app";

describe(
  "Webhook Invalid Signature",
  () => {

    test(
      "rejects invalid signature",
      async () => {

        const response =
          await request(app)

            .post(
              "/webhooks/payment-provider"
            )

            .set(
              "X-Provider-Signature",
              "bad-signature"
            )

            .send({});

        expect(
          response.status
        ).toBe(401);

      }
    );

  }
);