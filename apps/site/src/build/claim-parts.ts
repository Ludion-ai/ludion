// A claim cut into the parts a page can set in different type, without changing a word: the generated headline
// ("vitest >=4.0.0 changed what `vi.restoreAllMocks` does."), the detail, and the sentence generateClaim ends with
// (packages/core, claim.ts): "Silent: …" for a silent change, "Older versions don't have it." for an addition.
// Joined with spaces, the parts are the claim again. A claim that doesn't start that way (format 0) is all head.
import { firstSentence } from "./knowledge.ts";

export const SILENT_SENTENCE = "Silent: code written for older versions still runs, without an error.";
export const ADDED_SENTENCE = "Older versions don't have it.";

export interface ClaimParts {
  head: string;
  detail: string;
  /** The closing sentence and what it says, or null when the claim has none. */
  tail: { text: string; kind: "silent" | "added" } | null;
}

export function claimParts(claim: string): ClaimParts {
  let rest = claim.trim();
  let tail: ClaimParts["tail"] = null;
  for (const [text, kind] of [[SILENT_SENTENCE, "silent"], [ADDED_SENTENCE, "added"]] as const) {
    if (rest.endsWith(text)) {
      tail = { text, kind };
      rest = rest.slice(0, -text.length).trimEnd();
      break;
    }
  }
  const head = firstSentence(rest);
  return { head, detail: rest.slice(head.length).trim(), tail };
}

/** The parts joined back: the claim, word for word. */
export const joinParts = (p: ClaimParts) => [p.head, p.detail, p.tail?.text].filter(Boolean).join(" ");
