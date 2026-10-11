import { expect, test } from "vitest";
import { latestRates } from "../../src/rates";

// Talks to the real API: checks that the response still has the shape our client expects.
test("the live API returns today's rates", async () => {
  const r = await latestRates("USD");
  expect(r.base).toBe("USD");
  expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Object.keys(r.rates).length).toBeGreaterThan(10);
});
