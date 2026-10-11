import { expect } from "vitest";

expect.extend({
  toBeCents(received: unknown) {
    const pass = Number.isInteger(received) && (received as number) >= 0;
    return { pass, message: () => `expected ${String(received)} ${pass ? "not " : ""}to be a whole, non-negative number of cents` };
  },
});
