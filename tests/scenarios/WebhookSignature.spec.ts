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
  "Webhook Signature",
  () => {

    test(
      "accepts valid signature",
      async () => {

        const response =
          await request(app)

            .post(
              "/webhooks/payment-provider"
            )

            .set(
              "X-Provider-Signature",
              "valid-signature"
            )

            .send({});

        expect(
          response.status
        ).toBe(200);

      }
    );

  }
);