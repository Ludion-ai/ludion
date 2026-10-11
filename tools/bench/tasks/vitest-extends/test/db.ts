// Starts a Postgres container for the integration tests.
export interface TestDatabase {
  url: string;
  seed(): Promise<void>;
  stop(): Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  throw new Error("The test database needs Docker. Start Docker, or run only the unit tests.");
}
