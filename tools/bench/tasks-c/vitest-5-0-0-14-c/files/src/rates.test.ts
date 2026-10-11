import { expect, test } from "vitest";
import { latestRates } from "./rates";

test("reads the rates", async () => {
  const r = await latestRates();
  expect(r.rates.EUR).toBe(0.9);
});
