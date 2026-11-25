import request from "supertest";

import {
  describe,
  expect,
  test
} from "vitest";

import app
from "../../src/app";

describe(
  "Subscription Validation",
  () => {

    test(
      "rejects missing fields",
      async () => {

        const response =
          await request(app)
            .post(
              "/subscriptions"
            )
            .send({});

        expect(
          response.status
        ).toBe(400);

      }
    );

  }
);