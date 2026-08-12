# Inspecting

`BOUNDARY_MASK` and the size bounds in [cutting.md](cutting.md) are stated guesses, made without a corpus to measure. This component is how they stop being guesses: a script that takes real documents and prints what the sentence splitter and the cutter actually did to them, so the numbers are set from observation and a surprise in either component is visible before it reaches a user.

It is a development tool, not part of the app. Nothing imports it and it ships no behavior.

## Contract

### Running it

`npx vite-node scripts/debug-chunking.ts -- <path> [options]`, where `<path>` is a markdown file or a directory of them. Output goes to stdout. It reads files and nothing else — no network, no app state, no database, no browser.

Four flags set the rule the run is measured under, each defaulting to the constant it overrides: `--mask <bits>`, `--window <chars>`, `--floor <chars>` and `--ceiling <chars>`. They exist because the point of this component is to choose those numbers, and a report that could only ever measure today's values would be arguing for them rather than testing them. The header prints the rule in effect, so a dump can be read next to the numbers that produced it.

The three knobs the walk needs travel together as a `CutRule`, which is what `cutUnits` takes. Setting one without the others is how a caller ends up measuring a rule nobody runs.

The script is the entry point and nothing more. Its computations live in `app/lib/debug/chunking-report.ts`, because vitest collects `app/**/*.test.ts` and a test beside the script would never run.

### A single file: the annotated dump

The mode that answers "what did it do to my document". The file is printed back with three things overlaid:

- Every sentence numbered, one per line, carrying its inline markdown as [sentences.md](sentences.md) produced it.
- A rule between sentences wherever a unit boundary fell.
- A header on each unit giving its sentence range, its character size, the first characters of its hash, and why it closed: **content test**, **ceiling**, or **end of document**. The floor never closes a unit — it only suppresses — so it is reported instead as a count of gaps it suppressed inside each unit.

Both come from the cutter's own gap rule rather than from arithmetic restated here, so the report cannot drift from what the walk actually did.

Naming why each unit closed is the part that makes the dump diagnostic rather than decorative. A document where every unit says "ceiling" is a document where the content test never fires, and that is the failure this report exists to catch. A high suppression count means the floor is doing most of the work, which is the other way the same failure looks.

### A directory: the distribution

The mode that sets the constants.

| Section               | What it reports                                                                                                                     |
| :-------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| Sentence lengths      | Count, mean, and the 10th, 50th, 90th and 99th percentiles, per file and over the corpus                                            |
| Unit sizes            | The same percentiles, plus the share of units closed by the content test versus the ceiling, and how many gaps the floor suppressed |
| Mask sweep            | The unit-size distribution the corpus produces at masks of 2, 3, 4, 5 and 6 bits, each cut for real                                 |
| Stability probe       | Per file: units surviving an edit, as described below                                                                               |
| Segmentation warnings | Sentences containing an unbalanced markdown construct, and sentences over the ceiling                                               |

The mask sweep re-runs the whole cut at each candidate width rather than predicting from mean sentence length. The floor and the ceiling distort the arithmetic enough that a formula would be misleading, and running it is cheap.

Segmentation warnings are how a gap in `neutralizeMarkdown` surfaces. A sentence holding an opening bracket without its closing one, or an opening backtick without its pair, means the segmenter cut inside a construct — which is a defect in [sentences.md](sentences.md), reported here because this is where a real corpus meets it.

### The stability probe

The property the whole feature exists for, measured directly rather than argued.

For each file: cut it, insert a sentence at the start of the first unit, cut it again, and report how many units' hashes appear in both runs. The number to expect is _all but the first two_. A run where the survival count collapses means the floor is desynchronising more than the design claims, and that is a finding about [cutting.md](cutting.md) rather than about the document.

The probe repeats with the insertion at the midpoint of the document, because an edit in the middle should leave the units before it untouched as well as re-syncing after it — a different claim from the first, and one an edit at the top cannot test.

### Sample documents

The script reads whatever directory it is pointed at, and a small corpus lives with it under `scripts/fixtures/chunking/`, covering the shapes the corpus is expected to hold: a transcript of short turns with repeated affirmations, prose with long sentences, a document dense with links and inline code, a document with tables and nested lists, and a document that is mostly one fenced code block.

That directory is also the fixture corpus for [sentences.md](sentences.md)'s property tests. One place to add a document that broke something, and it becomes both an example to look at and a case that fails.

## Prior art

**`scripts/debug-scout-chunks.ts` is the pattern to follow.** It already reads a path from `process.argv`, imports app modules through the `~/` alias, prints a usage line when called wrong, and renders a document with `formatNumberedPassage`. This is a second script beside it, not a framework for scripts.

**The dump numbers its own rows.** `formatNumberedPassage` in `app/lib/text/format.ts` looks like the tool for it, but it re-splits the text it is handed with the plain splitter rather than the markdown-aware one the sentence array is built with, so it cuts inside URLs and numbers rows the unit's own sentence range disagrees with. The report is a diagnostic, and one that invents a sentence boundary is worse than none.

**Rejected: a vitest test that asserts the distribution.** The point of this component is to be read by a person choosing a number, and a test that fails when a fixture document changes would be noise. The properties worth asserting — that units are contiguous, that sizes respect the bounds, that an edit leaves later hashes alone — are tested in [cutting.md](cutting.md), against constructed input rather than against whatever happens to be in the fixture directory.

**Rejected: rendering the report as HTML.** A terminal dump is diffable, pasteable and needs no build step, and nothing about the numbers wants a chart.

## Tests

### Skeleton

Item 1 of the walking skeleton is this script's output over the sample document: sentences carrying markdown, no boundary inside a URL, and unit sizes that vary.

### Contract

The computations are pure and tested; the printing is not.

> **Given** a list of sizes, **when** percentiles are computed, **then** they match hand-computed values for an odd-length and an even-length list, and an empty list reports no percentiles rather than throwing.

> **Given** a document and a mask width, **when** the sweep runs, **then** the units it reports are the same units [cutting.md](cutting.md) produces at that mask — the sweep re-uses the cutter and does not re-implement it.

> **Given** a document and an insertion point, **when** the stability probe runs, **then** the survival count equals the number of hashes present in both runs, counted with multiplicity so a repeated unit is not over-counted.

> **Given** a sentence containing a bracket with no closing bracket, **when** warnings are collected, **then** it is reported.

> **Given** a path to a directory with no markdown files, **when** the script runs, **then** it prints that and exits without error.

> **Given** no path at all, **when** the script runs, **then** it prints a usage line and exits non-zero.

### Isolation

The report's functions take documents as strings and return numbers, so no file system is involved in testing them. Only the entry point reads a path, and it is thin enough to leave untested.
