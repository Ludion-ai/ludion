import { expect, test } from "vitest";
import { invoiceLabel, invoiceTotal } from "../src/invoice";

test("totals are whole cents", () => {
  expect(invoiceTotal([{ cents: 250, qty: 3 }])).toBeCents();
});

test("label shows dollars", () => {
  expect(invoiceLabel([{ cents: 250, qty: 3 }])).toBe("Total $7.50");
});
