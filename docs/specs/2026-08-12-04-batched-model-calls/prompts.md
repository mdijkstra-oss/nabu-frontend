# Prompts

The cross-repo half. Payloads and prompts describe one shape or they describe two; every edit here exists to keep them one. All paths are in the sibling `nabu-prompts` repository, and these edits ship with the frontend change — the self-hosted stack mounts this config, so a frontend that renders the new envelope against a prompt describing the old one is a broken deploy, not a transition state.

## Contract

### The shared fragment

Two files under `config/shared/entries/`, included the way `hyde/shape.md` already is:

- `shape.md` — the envelope: each item arrives as `<entry id="N" file="…">`, ids are ordinals within this request, `file` names the document the content came from and entries may come from different documents, metadata elements come before the content, and the whole attribute set is `id` and `file`. Three or four sentences; if it needs more, the shape stopped being simple enough to share.
- `numbered.md` — for the three sites whose answers reach inside an entry: sentences appear one per line as `[N.n]`, numbering restarts inside every entry, and answers name sentences as refs like `3.7` — entry 3, sentence 7. Refs may only name sentences that were shown.

Sites include what they use: scout and the two deep-analysis prompts include `shape.md` alone; the search filter, region finder and region marker include both.

### The six edits

| Prompt                               | What changes                                                                                                                                                                                                                                              | What must not change                                                                                                                                                                                                                                                                  |
| :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `semantic-filter/semantic-filter.md` | `<target prefix="X">` and `a-1` refs become the fragment's entries and `1.2` refs; the example JSON updates; sentences in the judgment section that say "target" rename to "entry"                                                                        | The matching bar, the borderline rules, the span-minimality rules — the judgment section keeps its rules intact; only the entity it names changes                                                                                                                                     |
| `scout-filter/scout-filter.md`       | The entry description defers to the fragment; a line notes entries name their file                                                                                                                                                                        | The exclusion semantics: ranges of consecutive ids, no isolated entries, keep when uncertain                                                                                                                                                                                          |
| `region-finder/region-finder.md`     | "a numbered stretch" becomes several entries, possibly from different documents; the answer must acknowledge **every** entry, an empty list being an ordinary answer per entry rather than per call                                                       | The quote rules — copied exactly, never paraphrased — stay verbatim: the quote is what grounds the model in the text (it directs the model; it is not data and never becomes a ref). The value-reuse rules stay                                                                       |
| `region-marker/region-marker.md`     | One window with one occurrence becomes entries carrying several `<occurrence n ref>` children; "the occurrence is already located and is not in doubt" is said once, about all occurrences; answers are per occurrence, named by entry id and ordinal `n` | The reach rules: contiguous, must include the occurrence's sentence, end at the entry's edge when the text runs past it — now per entry rather than per window                                                                                                                        |
| `deep-analysis-filter/index.md`      | The shape block: `<target id code>` becomes `<entry id file>` with `<code>` as the first child; the paragraph describing the wrapper renames its tag                                                                                                      | Everything else keeps its rules intact: the vote-only-inside-`<marked>` instruction (that sentence shares a paragraph with the tag description, so the paragraph is edited, its instruction preserved), the quote-the-language demand, the evaluation order, the distribution warning |
| `deep-analysis-adjudicate/index.md`  | Same shape edit; `<keep-case>`/`<remove-case>` documented as leading children                                                                                                                                                                             | The adjudication criteria                                                                                                                                                                                                                                                             |

The response schemas these prompts describe live in the frontend as zod ([search.md](search.md), [regions.md](regions.md), [deep-analysis.md](deep-analysis.md)); the prompt shows an example, the schema is the definition, and the example is checked against the schema when the frontend contract tests render it.

### Knowing a prompt didn't get worse

The check is the walking skeleton's step 2: the batched pass must find the same values at the same extents as the current single-call code on documents written to be unambiguous. That covers the two prompts that change most (finder, marker). The search filter's change is the ref form alone, checked by step 3's spans reading correctly; scout and the deep-analysis prompts keep their payload text and only re-describe its wrapper.

## Prior art

- The `[hyde/shape.md]` include pattern — three prompts already share one fragment this way; `entries/` is the same move.
- `markCacheBreakpoint` compatibility: fragments render into the preamble, which is exactly the cached prefix, so the shared text costs its tokens once per site, not once per call.

## Tests

**Skeleton.** Steps 1–4 all exercise these prompts against the real gateway; step 2 is the quality gate.

**Contract.** The prompts repository has no test harness; the enforceable side of this contract lives in the frontend's schema and rendering tests, which pin the payload the prompts describe. One case belongs here:

> **Given** each prompt's example response, **when** parsed by the frontend schema for that endpoint, **then** it parses — an example that drifts from the schema is the contract breaking in documentation form.

**Isolation.** Each prompt is exercised in isolation by calling its endpoint with a hand-built payload through the dev stack — the same harness step the skeleton uses, per site.
