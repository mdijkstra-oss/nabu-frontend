# Schema

The spec shape is defined once, as a zod schema, and everything else in this feature derives from it: [resolver.md](resolver.md) reads the parsed spec and nothing rawer, [prompting.md](prompting.md) describes the schema to the LLM and nothing else, and the TypeScript types are inferred from the schema rather than written beside it. This component owns `app/domain/data-blocks/chart/schema.ts`, the spec half of `app/lib/chart/types.ts`, and the fixtures in `app/lib/chart/test-helpers.ts` that every chart test builds on. It knows nothing about resolving rows or drawing marks.

## Contract

### The union

`spec.type` discriminates four families: `"axis"`, `"pie"`, `"treemap"`, `"heatmap"`. The nine flat types are gone — `bar`, `stacked-bar`, `grouped-bar`, `line`, `area` and `scatter` are no longer types at all, because what they named was never a kind of chart but a kind of layer, and three of them named the same mark with a stacking flag baked into the name.

Pie and treemap keep exactly today's shape (`label`, `value`, optional `parent`, `color`, `tooltip`) and are not discussed further.

### The axis family

An axis chart is one x-axis and one or more layers drawn over it. Chart-level fields, shared by every mark:

- `x` — field binding for the independent axis. Required. Semantic, never positional: `x` is the category or time binding regardless of orientation.
- `orientation` — `"vertical"` (default) or `"horizontal"`. Names the direction bars run: vertical bars rise upward with categories along the horizontal edge; horizontal bars run sideways with categories along the vertical edge. The bindings never swap — `x` stays the category binding and each layer's `y` stays the measure in both orientations. The schema description states this in so many words, because the previous vocabulary (Recharts' `layout`, where `"vertical"` drew horizontal bars) is exactly what taught the prompt a broken example.
- `bands` — optional array of `{ from, to, label? }`, unchanged from today: shaded x-regions marking context the data does not carry.
- `tooltip` — optional template string, unchanged. It stays chart-level deliberately, so the tooltip component is untouched by this feature.

`layers` — required array, minimum one entry. There is no flat single-layer shorthand: a plain bar chart is a one-layer chart, and the parser accepts nothing else. One shape to parse, one shape to teach, one shape to resolve. Each layer:

- `mark` — `"bar"`, `"line"`, `"area"`, or `"scatter"`. The layer's discriminant.
- `y` — field binding for this layer's measure. Required. Each layer binds its own value column, which is what lets two measures from one wide query become two layers instead of an UNPIVOT.
- `series` — optional field binding. Splits the layer into one drawn series per distinct value of this column.
- `color` — required, same three forms as today: entity property template (`{code:color}`), column template (`{column}`), or a Radix token literal. The refinement is tightened to accept only templates the color evaluator can resolve — exactly one placeholder, reading a column raw or an entity's color — because a template that parses here and throws at render time would break the parse-don't-validate contract.
- `stack` — boolean, default `false`. Meaningful on `bar` and `area` marks only; `true` marks this layer's series as stacking — which series stack together is [resolver.md](resolver.md)'s contract, stated there once. Stacked bars are now bar series with `stack: true`; grouped bars are the same with `stack: false`; area no longer auto-stacks — stacking is always said, never implied by a type name.
- `axis` — `"left"` or `"right"`, default `"left"`. Which y-axis scales this layer, so a count and a ratio can share a chart without one flattening the other.

`stack` on a `line` or `scatter` layer is **rejected, not ignored**. The layer schema is a discriminated union on `mark`: the bar and area members carry `stack`, the line and scatter members give the key no legal value, so a spec carrying it fails the parse and the inferred type cannot hold it. Silently stripping the key was considered and rejected — a stripped field teaches the LLM that the field works.

Defaults are materialized at parse: `orientation`, `stack`, and `axis` come out of `parseChart` as concrete values, never `undefined`, so no downstream reader re-decides what absent means. Parse, don't validate — the resolver and renderers see only the parsed shape.

### The heatmap

`heatmap` keeps `x`, `y`, `value`, `tooltip`, but its `color` is restricted to a Radix token literal — membership in `BLOCK_COLORS`, the same set the general refinement's token half checks. The token seeds a value→shade ramp over that scale, so templates make no sense here: a per-row color has no place in a field where one hue must fan into twelve shades. The description says exactly that, because the restriction differing from the other families is the kind of thing the LLM will get wrong unless told.

### Descriptions are the documentation

The `.describe()` strings are the LLM's manual and carry the same care as today's — the color description still teaches the VALUES-list recipe, the format description still names d3 specifiers. Two rules new to this round must appear verbatim in them:

- **Layers versus series**, on `layers` and on `series`: distinct measure columns in the result → one layer each; categories arriving as values in a column → one layer with `series` bound to that column.
- **Orientation semantics**, on `orientation`: it names the direction bars run, and the bindings never swap.

[prompting.md](prompting.md) restates these rules with recipes, but the schema states them first, so a reader of either never meets a contradiction.

### What parseChart accepts and rejects

`parseChart(content)` is unchanged in signature and temperament: JSON-parse, `safeParse` against `ChartSchema`, return the typed block or `null`. It never throws. The chart-level fields carry over — `id`, `caption.label`, and `query` with the `SEMANTIC()` refinement, since semantic search is a search-only function and a chart query using it can only fail later and worse.

The old flat format is deleted outright, with no desugaring and no translation layer: a block whose spec says `type: "bar"` fails the discriminant and returns `null`, which is the existing degrade path — the block renders raw instead of crashing. The system has no users yet, so the only old-shape specs anywhere are this repository's own fixtures and stories, and those are rewritten, not translated.

Query-time validation runs after the parse exactly as today, with one addition: chart query validation also rejects the `||` concatenation operator (`rejectConcatOperator`, applied in `validateChartQuery` beside `rejectSqlPatterns`), closing the one rule the prompt taught that no validator enforced — scoped to charts, because `rejectSqlPatterns` also gates search SQL, whose own prompts teach no such rule. The one touch this shape change forces is `collectReferencedFields` in `template.ts` — same output contract (the set of columns the spec reads), new traversal, and the traversal must be complete over **every family**: for axis, the chart-level `x`, each layer's `y` and `series`, and each layer's color template's fields; for pie and treemap, `label`, `value`, `parent`, and the color template's fields, exactly as the current walk visits them — the part family is unchanged and its validation must not quietly regress; for heatmap, `x`, `y`, and `value` (its color is a token literal and references no column); and for every family, the chart-level tooltip template's fields. This enumeration lives here and only here; [resolver.md](resolver.md) states why completeness matters and defers the walk to this file.

### The icon property dies

`TemplateRefOp`'s property union drops `"icon"`, and `ENTITY_PROPERTIES` in `template.ts` shrinks to match. The lookup has always rendered `{code:icon}` as an empty string — a documented lie, since an icon is a React component and a template resolves to text. After removal, `{code:icon}` is read as an unrecognized tail, the same fate `{code:anything}` already has; no special-case error is added, because the schema does not parse template internals and starting to would give one dead property a privileged diagnostic. `ChartEntityInfo.icon` goes with it — nothing in the chart system reads it; pills resolve their own icons through the entity-link machinery.

### Types derive, nothing restates

`ChartSpec`, `AxisChartSpec`, `ChartLayer`, `FieldBinding`, and their kin become `z.infer` exports of the schema. `types.ts` keeps its module position, and the cycle discipline is stated precisely because two of its three edges cannot bend: `schema.ts` value-imports `isTemplate` from `template.ts`, and `template.ts` value-imports `bindingField` and the family guards from `types.ts` and calls them — both necessarily runtime edges. The one edge that can and must be type-only is `types.ts`'s own import of the schemas: `import type` plus `typeof` over the schema objects for the `z.infer` derivations, so the cycle types → schema → template → types never closes at runtime. The hand-written interfaces that mirrored the schema field-for-field are deleted — two shapes that must agree is the drift this component exists to prevent. `bindingField` and `bindingFormat` survive unchanged; the family guards (`isAxisSpec` and friends) collapse to discriminant checks on `type`. The renderable types in the same file belong to [resolver.md](resolver.md) and are not touched here.

### Fixtures

`app/lib/chart/test-helpers.ts` is rewritten as part of this component's work. The old `Record<ChartType, …>` keying dies with `ChartType`'s old members; fixtures are keyed by name. The set must cover:

- one single-layer fixture per mark — `bar`, `line`, `area`, `scatter` — over the monthly rows,
- `stacked` and `grouped`: one bar layer with `series: "region"`, `stack` true and false respectively — the same pictures the deleted types drew, now said as layers,
- `combo`: a bar layer (`count`) and a line layer (`ratio`, `axis: "right"`) over wide rows — the walking skeleton's own spec, so stories and skeleton exercise one fixture,
- `wide-stacked`: two single-series bar layers, both `stack: true`, over wide rows — the stacked bar built from measure columns, the picture the old shape needed an UNPIVOT for and the one that pins cross-layer stack grouping,
- `horizontal`: a bar fixture with `orientation: "horizontal"`, pinning that the bindings do not swap,
- the banded fixture, carried over onto a stacked layer,
- `pie`, `treemap`, and `heatmap`, unchanged in shape but revalidated against the new schema (the heatmap fixture's color becomes a Radix token — the old hex literal is exactly what the restricted field now rejects).

This component's fixture remit stops at specs and rows. `test-helpers.ts` also hosts literal renderable fixtures for the renderer stories, but their shapes belong to [axis-chart.md](axis-chart.md) and [heatmap.md](heatmap.md) — today's `renderableOfKind`, which builds renderables by calling the resolver, is replaced by those literals per the renderers' isolation contracts.

## Prior art

**The existing `schema.ts` is the pattern, not the enemy.** The discriminated union on `type`, the `FieldBinding` string-or-object shape, the caption object, the `SEMANTIC()` query refinement, and the three-form color refinement with its VALUES-list description all survive verbatim — this round rearranges the axis family around them, it does not reinvent the parsing style. The zod `discriminatedUnion` idiom is already load-bearing in this file; the layer union on `mark` is the same idiom one level down.

**Rejected: adopting an external chart grammar** (vega-lite's schema being the obvious candidate, layered specs being its home turf). This spec is deliberately tiny, LLM-authored, and validated against live query results by `validateChartQuery` — a grammar surface a hundred times wider would hand the LLM a hundred ways to author something the renderers cannot draw, and its descriptions would document someone else's renderer.

**Rejected: a flat single-layer shorthand with desugaring.** Two accepted shapes means the prompt teaches both or contradicts one, and a desugarer is a second place the spec's meaning lives. One shape, one extra line of JSON for the simplest chart.

## Tests

### Skeleton

This component's part of the walking skeleton in [spec.md](spec.md): the two-layer combo spec, as JSON through the real `parseChart`, comes back non-null and typed — a bar layer and a right-axis line layer over one `month` x — and is what the skeleton's first story feeds the resolver. Not a hand-built renderable, so the schema is on the exercised path from day one.

### Contract

Riskiest first — the inputs that must die at the gate, then the shapes that must live.

> **Given** hostile or malformed content — not JSON, JSON that is not an object, an object missing `spec` — **when** parsed, **then** `parseChart` returns `null` and does not throw.

> **Given** an old-format block (`spec.type: "bar"` with flat `x`/`y`/`color`), **when** parsed, **then** `null` — no desugaring, the block degrades to raw rendering.

> **Given** an axis spec with `layers: []` or with `layers` absent, **when** parsed, **then** rejected — a chart with nothing to draw is not a chart.

> **Given** a layer with an unknown mark (`"lollipop"`), or a spec with an unknown family type, **when** parsed, **then** rejected.

> **Given** `stack: true` on a `line` or `scatter` layer, **when** parsed, **then** rejected by the schema — the mark-discriminated layer union has no member that holds it.

> **Given** `orientation` `"vertical"` and `"horizontal"`, **when** parsed, **then** accepted; `"diagonal"` rejected; absent materializes as `"vertical"`. Likewise `stack` absent materializes as `false` and `axis` absent as `"left"`, and `axis: "middle"` is rejected.

> **Given** each color form on an axis layer — Radix token, column template, entity property template — **when** parsed, **then** accepted; hex literals, unknown tokens, and empty strings rejected. **Given** the same forms on a heatmap, **then** only the Radix token survives — both template forms are rejected there.

> **Given** `{code:icon}` in a template, **when** the template is parsed, **then** the op is not a property op — `"icon"` falls through as an unrecognized tail, and the `TemplateRefOp` type no longer admits it.

> **Given** `SEMANTIC('x')` anywhere in `query`, **when** parsed, **then** rejected with the search-only message — carried over unchanged.

> **Given** the combo fixture's spec — two layers, mixed marks, one on the right axis — and the stacked, grouped, and horizontal fixtures, **when** parsed, **then** accepted, with every defaulted field concrete in the output.

> **Given** a field binding that is an empty string or an object with an empty `field`, **when** parsed, **then** rejected — at chart level and inside a layer both.

### Isolation

Pure zod parsing: JSON strings and plain objects in, a typed block or `null` out. No database, no resolver, no renderer, nothing to fake. The fixtures this component rewrites are inputs here and shared with every downstream component's tests, which is what makes them worth specifying rather than improvising.
