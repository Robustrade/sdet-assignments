import request from "supertest";

import {
  describe,
  expect,
  test
} from "vitest";

import app
from "../../src/app";

describe(
  "Create Subscription API",
  () => {

    test(
      "creates subscription",
      async () => {

        const response =
          await request(app)
            .post(
              "/subscriptions"
            )
            .send({
              customerId:
                "cust_001",

              plan:
                "pro"
            });

        expect(
          response.status
        ).toBe(201);

        expect(
          response.body
            .customerId
        ).toBe(
          "cust_001"
        );

        expect(
          response.body.plan
        ).toBe(
          "pro"
        );

      }
    );

  }
);