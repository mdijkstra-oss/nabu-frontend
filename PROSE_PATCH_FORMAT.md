# Prose Patch Format

This document describes the patch format used by the LLM to mutate Markdown prose in this repository (the `apply_local_patch` tool's `update_file` and `create_file` operations). Structured JSON data inside fenced ` ```json-* ` blocks uses a separate path (RFC 6902 JSON-Patch via `fast-json-patch`) and is **not** covered here.

The format is a custom variant of OpenAI's "v4a" unified diff — rolled in-house in `app/lib/patch/`, with no `diff` / `jsdiff` dependency for the prose path. The matcher tolerates per-line drift (whitespace, casing, punctuation, Markdown decoration) but every needle line must align against a real file line. There is no cross-line paraphrase fallback.

## File-level envelope

Every patch is one or more file operations. Each opens with a header line:

```
*** Update File: notes/method.md
*** Add File: notes/new.md
*** Delete File: notes/old.md
```

`Update File` bodies contain one or more hunks. `Add File` bodies are the new file's literal contents (no prefixes). `Delete File` has no body.

## Hunks

A hunk opens with `@@` on its own line. An optional section hint may follow (`@@ ## Sampling`) — it is ignored by the parser and exists only for human readability. Inside a hunk, every line carries one of three prefixes:

- `+ inserted line`
- `- removed line` (must currently exist in the file)
- `  context line` (must currently exist; not modified)

The parser treats any line that is neither `+` nor `-` as context — there is no leading space required for context lines in practice; the prefix can be visually absent. To anchor the change unambiguously, the matcher requires at least **3 non-blank context-or-remove lines** per hunk (`DEFAULT_MIN_CONTEXT_LINES` in `app/lib/patch/diff/parse.ts`). Pure insertion into an empty file or at end-of-file is allowed without context.

## Skip marker `...`

Inside a hunk, a single `...` on its own line means "skip everything between the lines above and the lines below." The resolver locates the unique start anchor (text before `...`) and unique end anchor (text after `...`) and fills the gap from the live file as if it had been written out. Both anchors must each match exactly once; ambiguity is an error.

```
@@
 ## Sampling
 We recruited N=42 participants.
 ...
 ## Analysis
+
+We coded transcripts inductively.
 We used inductive coding.
```

## Range reference `+<<` / `-<<`

Pulls a contiguous range of text from another file (or the current one) into the hunk. Header line is `+<< path/to/file.md` (or `-<<`, or bare `+<<` for the current file). The body is indented with the same prefix and **two spaces**, with a `...` separator between start anchor and end anchor:

```
+<< notes/intro.md
+  First anchor line
+  ...
+  Last anchor line
```

Both anchors must match uniquely in the referenced file. The resolver expands the range inline before diffing. Use it to quote real text from elsewhere without retyping (and risking drift).

## Matching is line-based, with fuzzy tolerance per line

The matcher absorbs whitespace, casing, punctuation, and Markdown-decoration drift while requiring real line-by-line anchoring. Two stages run in sequence after normalization:

**Stage 0 — Normalization** (`app/lib/patch/diff/normalize.ts`). Applied identically to both file and patch before any comparison:

- trailing whitespace stripped
- leading double-spaces converted to tabs
- list markers `-` and `+` rewritten to `*`
- consecutive blank lines collapsed
- headings receive a blank line before and after

Whitespace and list-marker drift become invisible.

**Stage 1 — Per-line candidate gathering** (`app/lib/patch/diff/search.ts`, `findLineCandidates`). For each needle line, find every file line that could match it:

1. Exact `===` line equality first (after stage 0 normalization).
2. If no exact hits, fall back to per-line token fuzzy: lowercase + edge-punct strip, find the longest contiguous token run between needle and content line. Accept the candidate if either _full match_ (all needle tokens matched AND ≥50% of content-line tokens) or _partial match_ (run of ≥2 tokens AND ≥50% of needle).

**Stage 2 — Block alignment** (`findConsecutiveBlocks`). The per-line candidates from stage 1 must line up consecutively in the file: needle line 0 at index `i`, needle line 1 at `i+1`, …, needle line n-1 at `i+n-1`. If one or more aligned blocks are found, the matcher returns them. Otherwise the hunk fails with a "patch context not found" or "context too short" error (≥3 non-blank context/remove lines required for a "not found" diagnosis).

If multiple aligned blocks remain, the matcher returns an ambiguity error listing each candidate with three lines of surrounding context — the author resolves by adding more anchor lines. If nothing matches, the patch fails; the LLM must re-read the file and quote real text, not paraphrase. There is no cross-line substring fallback for single-line needles — every needle line must align as a line.

## JSON blocks are off-limits

The `apply_local_patch` handler rejects any prose patch that touches the interior of a fenced ` ```json-* ` block (`detectBlockTouches` in `app/lib/agent/tools/apply-local-patch/handler.ts`). Structured-data edits go through the generated `patch_<lang>` / `add_<lang>` / `delete_<lang>` / `move_<lang>` tools, which emit RFC 6902 JSON-Patch operations applied by `fast-json-patch` (`app/lib/patch/structured-json/apply.ts`). The prose format is for prose, headings, list items, code fences with non-JSON languages, and the Markdown skeleton around blocks.

## Minimal example

```
*** Update File: notes/method.md
@@ ## Sampling
 ## Sampling
 We recruited N=42 participants.
-They were paid $20.
+They were paid $25 USD.
 ...
 ## Analysis
+
+We coded transcripts using the constant-comparative method described above.
 We used inductive coding.
```

Three context lines around the price change, a `...` skip jumping to the next heading, an insertion below it.

## Source map

| Concern                                                          | File                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Top-level entry, validation, ID stamping                         | `app/lib/patch/apply.ts`                                               |
| v4a diff parser, hunk application                                | `app/lib/patch/diff/parse.ts`                                          |
| Fuzzy line matcher                                               | `app/lib/patch/diff/search.ts`                                         |
| Pre-match normalization                                          | `app/lib/patch/diff/normalize.ts`                                      |
| Internal fuzzy match engine (used by annotation text resolution) | `app/lib/text/find.ts` (`findMatchOffset`)                             |
| `+<<` / `-<<` range references                                   | `app/lib/patch/resolve/range-expand.ts`                                |
| JSON-block boundary handling                                     | `app/lib/patch/resolve/json-boundary.ts`                               |
| RFC 6902 path (JSON blocks only)                                 | `app/lib/patch/structured-json/apply.ts`                               |
| LLM-facing prose patch prompt                                    | `hermes-logos/prompts/tools/patching/diff-format.apply_local_patch.md` |
