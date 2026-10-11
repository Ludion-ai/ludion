import { expect, test } from "vitest";
import { slugify } from "../../src/slugify.ts";

test("turns a title into a slug", () => {
  expect(slugify("Hello, World!")).toBe("hello-world");
});
