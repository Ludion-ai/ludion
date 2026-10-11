import { expect, test } from "vitest";
import { priceBadge } from "../src/badge";

test("badge shows the price", () => {
  expect(priceBadge(1999)).toBe('<span class="price">$19.99</span>');
});
