import { afterAll, beforeAll } from "vitest";
import { startTestDatabase, type TestDatabase } from "./db.ts";

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
  await db.seed();
});

afterAll(async () => {
  await db?.stop();
});
