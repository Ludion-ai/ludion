// A static page with a component that hydrates in the browser.
import { Counter } from "./counter";

export default function About() {
  return (
    <main>
      <h1>About</h1>
      <Counter />
    </main>
  );
}
