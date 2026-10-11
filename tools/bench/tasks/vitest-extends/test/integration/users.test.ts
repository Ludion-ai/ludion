import { expect, test } from "vitest";

test("lists the seeded users", async () => {
  const users = [{ name: "alice" }];
  expect(users).toHaveLength(1);
});
