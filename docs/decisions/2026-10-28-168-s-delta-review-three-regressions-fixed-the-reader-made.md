## 2026-10-28 (cycle 3, L1) — #168's delta review: three regressions fixed, the reader made linear, and a third execution beside the result

#168's delta review (at 93d778b) found three places where 6c4f58e leaves out what c381a85 counted and section 2 calls production:
- A: a stylesheet import clause that runs across lines;
- B: a type-only brace list that swallows a real import;
- C: here-strings (`<<<`) and shifts (`1<<2`) read as heredocs.

So the premise in the entry above, that every fix only adds production, did not hold; `beside.mjs` checked the subset rather than assuming it, and the check held. The review also found quadratic paths on crafted files.

- **The fixes.**
  - Stylesheet clauses end at a line break (unless the line ends with a comma), at `;`, `{`, `}` or the next `@` outside quotes. c381a85's reading is kept beside them, so no stylesheet import it read is lost.
  - A type-only brace list cannot hold quotes, semicolons or braces.
  - A heredoc needs `<<` as its own word followed by a delimiter that starts with a letter or `_`, and a closing line; without one, the line is read as written.
  - The import-call reader skips comments with cached positions; the YAML readers and the stage chain use loops.
- **A third execution** at the commit with these fixes, with the same script, sample, sources and image, is reported beside the result, never instead of it, in `docs/bench/2026-10-28-noise-v2/result-final/`. Its misses are counted from the review's verdicts as in the entry above, with `beside.mjs`, and a package the review did not check counts as undecidable. The result (c381a85) stays the result.
- **Outcome.** The third execution (9313aa2) gave the same numbers: the judge 938, the same 160 left out, 11 misses in 4 repositories. Afterwards, 9cd7ebc fixed two ways to hide an import that an automated security review found (more than 16 comments before an import call's specifier; a stylesheet list continued on the next line). Those changes only add readings, so on this sample they can only keep or lower the left-out list. They were not run on the sample.
- **Correction (#168's second delta review).**
  - "Only add readings" was not true in general: 9cd7ebc's stylesheet `limit` could end a clause at an at-rule inside a quoted string. The reviewer's run of every version's reader over the 101 source trees found no package lost on this sample.
  - The next commit reads a heredoc delimiter as a shell word, which fixes a regression against 6c4f58e. It also splits unquoted stylesheet lists, looks scripts up by name, and ends a stylesheet clause only at an at-rule outside quotes and comments.
  - None of these was run on the sample.
