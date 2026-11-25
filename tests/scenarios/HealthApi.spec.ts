import request from "supertest";
import { describe, expect, test } from "vitest";

import app from "../../src/app";

describe("Health API", () => {

  test(
    "returns 200",
    async () => {

      const response =
        await request(app)
          .get("/health");

      expect(
        response.status
      ).toBe(200);

      expect(
        response.body.status
      ).toBe("ok");

    }
  );

});