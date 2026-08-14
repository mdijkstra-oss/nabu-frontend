# Prompting

This component rewrites `config/shared/qualitative-researcher/charting.md` in the sibling `nabu-prompts` repository — the prompt that teaches the LLM to author `json-chart` blocks — against the layered schema that [schema.md](schema.md) owns. The deliverable is the rewritten prompt file itself; this spec describes what that file must contain and why, and deliberately contains none of it. It is built last, after every other component, because a prompt can only describe a schema that has stopped moving.

The boundary is strict in one direction: the prompt describes exactly the spec shape [schema.md](schema.md) defines and nothing beyond it. Any field name, default, enum value or nesting the prompt teaches must be readable off that schema; if the prompt needs a shape detail the schema does not state, the schema is incomplete, not the prompt inventive. What the prompt adds — and all it adds — is judgement: which shape to reach for given the user's question, and how to write the SQL that feeds it.

## Contract

### The invariant: three texts, one rule

The current prompt's most valuable property is that every hard rule exists in three places that agree: the prompt states it with its reason, a validator enforces it, and the validator's error message restates it in the same terms — so the model that breaks a rule reads back the rule it was taught, not a stack trace. The three places are:

| Voice             | Where                                                                                                                                                                                                                                             |
| :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Taught            | `charting.md` in `nabu-prompts`                                                                                                                                                                                                                   |
| Enforced          | `app/lib/sql/reject.ts` (`rejectCase`, `rejectStringFormatting`), `app/domain/data-blocks/chart/validate.ts` (`validateChartQuery`), and the zod refinements in `app/domain/data-blocks/chart/schema.ts` (the `SEMANTIC()` and color refinements) |
| Spoken on failure | The message strings in those same files, plus the `.describe()` strings on the schema, which are the schema half of the teaching                                                                                                                  |

Concretely today: no `CASE` (the reject message itself points to the VALUES-join alternative), no string functions on output columns, no `SEMANTIC()` in chart queries, color as token/template only, and every `{field}` template resolvable against the query's result columns. The rewrite keeps all five, keeps each stated with its reason, and states the agreement as a maintained property: **a change to a message in `reject.ts`, a refinement message in `schema.ts`, or a `.describe()` string is a change to what the model is told, and obliges a re-read of `charting.md` for drift** — in either direction. The prompt file itself carries a one-line note naming the two validator files, so an editor of either side can find the other.

### Section by section

The current file is structured as tagged sections — `<query>`, `<types>`, `<fields>`, `<templates>`, `<colors>`, `<bands>`, `<tooltip>`, `<shapes>` — and that structure survives where its content does, with one section added and one renamed. Per section, what the rewrite must contain, and whether each requirement preserves a strength, fixes a defect, or teaches a new schema feature:

**Preamble** — unchanged in substance: charts render a SQL query, and are created only when the user asks for a visualization, never unprompted. That negative rule was reviewed as a strength and stays verbatim in spirit.

**`<query>`** — the constraints survive with their reasons: no `CASE`, no string functions, columns returned as stored, entity axes select the `id` column so the renderer resolves names, colors and links, and every template field must exist in the result (the `validateChartQuery` check). One defect is fixed here: the current file states the no-SQL-color rule in full both in this section and in `<colors>`. The rewrite gives every rule one owning section — color rules live in `<colors>`, and `<query>` carries a one-line cross-reference, not a restatement. Duplicated rules drift independently; a cross-reference cannot.

**`<types>`** — rewritten for the four top-level types `axis | pie | treemap | heatmap`. The section keeps the strength the review named: the type is picked from the user's question, not from the shape of the data — compare, compose, trend, correlate, cross two categorical dimensions. `stacked-bar` and `grouped-bar` disappear as types; the decision "composition versus side-by-side" becomes the `stack` flag on a bar layer, and the types section says so in one sentence and points at the layers section. Heatmap's entry flips from "deferred, prefer a stacked-bar" to a real type with its own decision rule: reach for it when the question crosses two categorical dimensions of one measure and the grid itself is the finding.

**`<layers>`** — new, and the heart of the rewrite. An axis chart is chart-level `x`, `orientation`, `bands`, `tooltip` plus a required `layers` array; each layer is one mark (`bar | line | area | scatter`) with its own `y`, optional `series`, `color`, `stack` (default false), and `axis` side (default left). The section owns three pieces of judgement:

1. **Layers versus series, as a SQL rule.** The choice is made in the query before it is made in the spec: _distinct measures_ → a wide result, one column per measure, one layer per column; _categories in the data_ → a long result, one value column plus a category column, one layer with `series`. One example query per side, both in the qualitative-coding domain the prompt already inhabits (annotations joined to callouts, as its existing examples do). This rule is new content — the old schema could not express the wide side at all without UNPIVOT.
2. **Stacking is explicit, and works in both data shapes.** `stack: true` on a bar layer with a series is the old `stacked-bar`; absent, series bars sit side by side (the old `grouped-bar`). And `stack: true` on two single-series bar layers stacks the two measures into one bar — the wide-data stacked bar the old schema could not express, taught here in the same breath as the layers-vs-series rule so the model sees stacking works whichever side of that rule the query landed on. The old prompt's sentence "an `area` with a `series` stacks" inverts: an area layer draws overlapping bands unless `stack` is set. The prompt states the default and the inversion plainly, because it is the one place the new schema silently means something different from what the old prompt taught.
3. **Combo restraint.** A second layer must earn its place — the canonical case is a rate drawn over the counts it is computed from. A second `axis: "right"` only when the two layers' units genuinely differ; two count layers share the left axis. And the negative rule, in the same spirit as never-chart-unprompted: do not layer for decoration — a chart that answers the question with one layer gets one layer.

**Orientation** (taught in `<layers>` or `<types>`, wherever the rewrite reads best, but taught once): `orientation` names the direction bars run — `vertical` default, `horizontal` for rotated bars — and **field bindings never swap**: `x` is always the category binding, `y` always the value, whichever way the bars point. This fixes the current file's worst defect: its horizontal-bar example swaps `x` and `y` _and_ sets orientation, which under the old semantics fed a string column into the numeric channel. Under the new semantics the correct example is trivial — the vertical example with one field changed — and the rewrite includes exactly that pair so the contrast teaches the rule.

**`<fields>`** — survives nearly untouched: shorthand versus object binding, d3 format specifiers, `%`-prefixed patterns as time formats. Only its examples move onto the new shape.

**`<templates>`** — survives, minus one property: `{field:icon}` is removed from the property list, in the same change that removes it from the schema ([schema.md](schema.md) owns that removal). The current prompt advertises it; it renders empty. A prompt that documents a dead feature teaches the model to produce specs that look wrong to users, which is worse than the feature's absence.

**`<colors>`** — the single owner of every color rule. The four forms survive in the same priority order, which the review named a strength: entity color template first (recoloring a code in the codebook recolors every chart), then a color column, then a Radix token literal, then the VALUES-list join — with the argued distinction preserved verbatim in spirit: a VALUES list is a lookup table, which is why it is allowed where `CASE` is not, and every category needs a row or the join drops it. Color is now per-layer, and the "a chart with a series needs form 1, 2 or 4" rule becomes a per-layer rule. One addition: a heatmap's color is a single Radix token that seeds the value→shade ramp — form 3 is not merely allowed there, it is the only form — stated here once and cross-referenced from the heatmap section.

**`<bands>`** — survives with its examples re-expressed as layered specs. The negative rule stays: a band marks context the corpus does not carry, never a finding — findings belong to the caption and prose.

**`<tooltip>`** — survives: tooltips are chart-level (deliberately, per the parent spec, so the tooltip machinery is untouched), computed values are named SQL columns the template references, markdown and pill behavior unchanged.

**Heatmap section** — new, replacing the deferral. It carries the two recipes qualitative coding actually asks for, each as a worked SQL example against the tables the prompt's existing examples already use:

1. **Code × document counts** — annotations joined to callouts, grouped by code and file: where does each code land across the corpus.
2. **Code × code co-occurrence** — a self-join of annotations on the document (with an inequality to avoid the mirrored diagonal): which codes appear together.

Both examples select entity `id` columns so the heatmap's axis labels render as clickable pills, which is the same select-the-id rule `<query>` already teaches, now applied to two axes at once.

**`<shapes>`** — survives as the gallery of complete spec values, rewritten: one-layer bar, the horizontal pair described above, stacked and grouped bar as the same spec differing only in `stack`, a wide-data stacked bar (two single-series bar layers, both `stack: true`), multi-series line, area with explicit `stack: true`, scatter, a bar+line combo with a right axis, pie and treemap unchanged, and a heatmap. Every example in this section is subject to the tests below.

## Prior art

**The current `charting.md` is the prior art, and it was judged before this rewrite was scoped.** Its strengths, all preserved above: rules stated with their reasons rather than as bare prohibitions (the VALUES/CASE distinction being the exemplar); decision rules keyed to the user's question, not the data's shape; the color forms in explicit priority order; negative guidance given equal standing with positive (never chart unprompted, bands are context not findings); and the three-voice agreement between prompt, validators and error messages, which is the property this spec promotes from happy accident to stated invariant.

Its defects, all fixed above: the horizontal-bar example that teaches swapping field bindings — under the old semantics an instruction to put a string column on the numeric channel, and the reason the new orientation semantics exist; the advertised `{field:icon}` property that renders empty; and the color rules stated in two sections, which is two chances to drift.

**No other prompt file moves.** `config/qual-coder/index.md` includes `[qualitative-researcher/charting.md]` by reference and is the only prompt file that references charting at all — confirmed by search. The rewrite is one file in `nabu-prompts`; the include line, and every agent composed from it, picks up the new text unchanged.

## Tests

_Skeleton_: none. The prompt is not code and has no story in the walking skeleton; it is built last, against a schema the skeleton has already proven.

This component has no runnable test suite, but it has a checkable acceptance step, and the check is mechanical: every example in the rewritten prompt must survive the real validators. The verification is a scratch test (written, run, and discarded — not committed) that imports `parseChart` from `app/domain/data-blocks/chart/schema.ts` and `rejectSqlPatterns` from `app/lib/sql/reject.ts` and feeds them the prompt's own examples, pasted verbatim:

> **Given** every JSON spec example in the rewritten prompt, wrapped in the outer `{ id, caption, query, spec }` shape where the example shows only the spec value, **when** each is passed through `parseChart`, **then** every one parses to a non-null block — the prompt contains no example the schema rejects.

> **Given** every SQL example in the rewritten prompt, **when** each is passed through `rejectSqlPatterns`, **then** every one returns no errors — including the VALUES-join color example, which is the case the rule exists to permit.

> **Given** the horizontal-bar example pair, **when** the two specs are compared, **then** they differ in `orientation` and nothing else — the field bindings are identical, which is the lesson the pair exists to teach.

> **Given** the prompt's text, **when** it is searched for `icon`, `stacked-bar`, and `grouped-bar`, **then** none appears — the removed property and the collapsed types are gone from the teaching, not merely deprecated in it.

> **Given** each hard rule the prompt states (`CASE`, string functions, `SEMANTIC()`, color forms, template columns), **when** it is read beside the message strings in `app/lib/sql/reject.ts`, the refinements in `app/domain/data-blocks/chart/schema.ts`, and `validateChartQuery` in `app/domain/data-blocks/chart/validate.ts`, **then** each rule appears in all three voices and no voice states a rule the others lack. This one is a reading, not a script — it is the invariant, and it is re-run whenever any of the three files changes.

_Isolation_: the prompt is verified against the schema and the SQL rejector alone — pure functions, no database, no story runner, and no running LLM. Whether the prompt teaches _well_ is only observable in live authoring sessions and is out of scope here; what is verifiable is that nothing it teaches is false, and that is what these checks pin.
