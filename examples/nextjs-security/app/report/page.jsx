// Drawn on the server for each request, with what changes between requests: the time, a random number and an id.
// _.pluck is in lodash 3 and not in lodash 4, so moving this project to lodash 4 breaks this page and no other,
// and only when it is opened: nothing in the build reaches this call.
import { randomUUID } from "node:crypto";
import _ from "lodash";

export const dynamic = "force-dynamic";

export default function Report() {
  const names = _.pluck([{ name: "alpha" }, { name: "beta" }], "name");
  return (
    <main>
      <h1>Report</h1>
      <ul>
        {names.map(name => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <p>Drawn at {new Date().toISOString()}</p>
      <p>Sample {Math.random()}</p>
      <p>Request {randomUUID()}</p>
    </main>
  );
}
