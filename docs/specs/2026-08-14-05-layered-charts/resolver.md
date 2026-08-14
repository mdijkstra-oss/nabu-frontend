# Resolver

`resolveChartData` is the only reader of the chart spec. It takes the parsed spec from [schema.md](schema.md) and the query rows, and produces a **renderable** — a shape that carries everything a renderer needs and nothing a renderer would have to interpret. [axis-chart.md](axis-chart.md) and [heatmap.md](heatmap.md) consume the shapes defined here and nowhere else; if a renderer needs to look back at the spec, this contract has failed. That boundary is what makes the parent spec's flow claim true: a spec change is a schema edit plus a resolver edit, and no renderer holds a private copy of the spec.

## Contract

### In

`ResolveOptions` is unchanged from today: `spec` (the parsed `ChartSpec`), `rows` (the query result, an array of plain records), `entityMap` (id → label/url/color, built by the view from the rows), `colorContext` (the entity map plus a `resolveRadix` function, shade, and fallback — the whole of `color.ts`'s input, carried as data). The dispatch is by the spec's top-level `type`: `"axis"` resolves layers, `"pie"` / `"treemap"` resolve as parts, `"heatmap"` resolves as a matrix.

### Side effects: none

The resolver is a pure function — same options in, same renderable out; no clock, no DOM, no network, no module state. That is not hygiene, it is the test strategy: every behavior below is pinned by a table-driven unit test with plain data, and the one external-looking dependency, Radix token resolution, arrives as a function inside `colorContext`, so tests substitute a stub by passing an argument rather than mocking a module.

### The axis renderable

One row set for the whole chart, one series descriptor per drawn series across all layers. Every layer shares the chart-level `x` binding, so the resolver groups rows by x **once** and every layer writes into the same grouped rows.

**Series keys are synthetic.** Each series' data key is `l<i>s<j>` — layer index, series ordinal within the layer — and the display name is carried separately. Two things force this beyond mere uniqueness. First, two layers may bind the same column (`count` twice, at different marks) or pivot to the same label (two layers whose series columns share a value); data-derived keys collide there and no suffixing rule stays predictable. Second, Recharts reads a `dataKey` containing a dot as a path expression, so a key derived from a data value — an entity labelled "v1.2" — silently reads the wrong thing today. A fully synthetic key admits no character a data value can smuggle in. The cost is a renderer obligation, stated here and owned by [axis-chart.md](axis-chart.md): every mark sets its `name` prop to the descriptor's display name, so the tooltip fallback list and the legend never show a synthetic key.

**Series descriptors**, in order — layer order first, and within a pivoting layer the order of first appearance of the series value in the rows. This order is the legend order and the draw order.

| Field     | Meaning                                                                                               | Consumer                                                                           |
| :-------- | :---------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| `key`     | Synthetic data key `l<i>s<j>`; the property name in rows and in `_colors`                             | [axis-chart.md](axis-chart.md) mark `dataKey`, per-cell colors                     |
| `name`    | Display label: the series value's entity label for pivoting layers, else the layer's y label or field | [axis-chart.md](axis-chart.md) legend; ChartTooltip fallback via the mark's `name` |
| `mark`    | `bar` \| `line` \| `area` \| `scatter` — which Recharts element draws it                              | [axis-chart.md](axis-chart.md)                                                     |
| `color`   | Resolved hex, first contributing row's `resolveRowColor` result                                       | [axis-chart.md](axis-chart.md) fill/stroke                                         |
| `stackId` | Present iff the layer's `stack` flag is true; derived from the pair (mark, axis side)                 | [axis-chart.md](axis-chart.md) Recharts `stackId`                                  |
| `axis`    | `"left"` \| `"right"` from the layer                                                                  | [axis-chart.md](axis-chart.md) `yAxisId`                                           |

Stacking groups by **(mark, axis side)**: every stack-true descriptor of one mark on one side shares one `stackId`, across layers. This is the rule that serves both data shapes. Long-format: one bar layer pivoting a series column stacks its own series — today's `stacked-bar` without the type. Wide-format: two single-series bar layers each with `stack: true` stack into one bar — the case the layers design exists for, and the one a per-layer stack id would silently break by rendering the measures side by side. Mark in the key keeps a bar from ever stacking onto an area (the two encode a sum differently — length versus upper edge — and merging them makes both unreadable); side in the key keeps a left stack from ever summing with a right one, which would merge two scales.

How a layer becomes descriptors: a layer without `series` contributes exactly one, named from its y binding's label or field. A layer with `series` pivots — one descriptor per distinct series value, as the flat spec does today. A layer's series values are discovered from the rows, so with no rows a pivoting layer contributes no descriptors while a plain layer still contributes its one — the spec alone determines it.

**Rows** keep today's merged shape, re-keyed:

| Field           | Meaning                                                                                        | Consumer                                                        |
| :-------------- | :--------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `x`             | The group key, `toKey`-coerced so numeric x stays numeric                                      | [axis-chart.md](axis-chart.md) category axis                    |
| one per `key`   | The summed numeric value for that series at this x; **absent** when the series has no row here | [axis-chart.md](axis-chart.md) marks (absent ≠ zero: line gaps) |
| `_raw`          | The first source row of the x group, in input order                                            | ChartTooltip template resolution                                |
| `_tooltipNodes` | The chart-level tooltip template, parsed once, attached to every row                           | ChartTooltip                                                    |
| `_colors`       | Per-datum resolved color, keyed by the same synthetic keys                                     | [axis-chart.md](axis-chart.md) bar `Cell` fills                 |
| `_entityUrl`    | `findEntityUrl` over the first source row                                                      | [axis-chart.md](axis-chart.md) datum-click navigation           |

Aggregation is today's: duplicate `(x, series)` rows sum, values coerced through `toNumber` (non-numeric to 0). Per-datum color is the last contributing row's `resolveRowColor` result, the descriptor color the first's — both as the flat resolver already behaves. Keying `_colors` by the synthetic key is the reconciliation the namespacing demands: the bar renderer looks up `row._colors[descriptor.key]`, so two layers coloring the same column differently cannot clobber each other's cells.

Chart-level fields: `kind: "axis"`, `orientation`, `xFormat` (from the x binding), `bands`, and `leftAxisFormat` / `rightAxisFormat` — each taken from the first layer on that axis whose y binding declares a format, because one tick formatter serves one axis no matter how many layers feed it. There is no `type` field anymore: the mark lives on the descriptor, which is precisely what lets one `ComposedChart` mix them.

**One flat list.** All layers' descriptors flatten into a single ordered list — a pivoting layer with two values and two plain layers produce the same two-entry list. The legend rule that counts those entries belongs to [axis-chart.md](axis-chart.md); this contract only guarantees the list is flat and ordered so counting it means something.

**Why multi-series scatter comes out correct.** Today every scatter series redraws the first series' values: the renderer binds the y-axis to `seriesNames[0]` and hands every `Scatter` the whole row list, so the implicit value accessor reads the same field for all of them. Under this contract there is no implicit value — a scatter mark reads its descriptor's own key, and a key holds only the rows its own series produced. The bug is not fixed so much as made inexpressible.

### The part renderable

Unchanged, restated only as the contract: `kind: "part"`, `type` (`pie` | `treemap`), and rows each carrying `name` (entity-resolved label), `value`, `fill`, `_raw`, `_tooltipNodes`, `_entityUrl` — the fields `PartChart` and ChartTooltip consume. `_parent` is no longer emitted: the treemap renders flat and nothing read it. Pie and treemap resolution does not participate in layering.

### The matrix renderable

No longer a stub. Everything the grid needs, so [heatmap.md](heatmap.md) never touches rows or spec:

| Field                | Meaning                                                                                                  | Consumer                                                       |
| :------------------- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------- |
| `kind`               | `"matrix"`                                                                                               | dispatch                                                       |
| `xKeys`              | Ordered distinct x values, order of first appearance in the rows — **raw** values, not labels            | [heatmap.md](heatmap.md) column headers                        |
| `yKeys`              | Same for y                                                                                               | [heatmap.md](heatmap.md) row headers                           |
| `cells`              | **Nested** lookup, x key → (y key → cell), both keys `toKey`-coerced; a pair with no row has **no cell** | [heatmap.md](heatmap.md) grid body                             |
| `min`, `max`         | Extremes of the summed values over present cells; absent when there are no cells                         | [heatmap.md](heatmap.md) ramp endpoints                        |
| `colorToken`         | The spec's color, passed through as the raw Radix token name                                             | [heatmap.md](heatmap.md) ramp                                  |
| `xFormat`, `yFormat` | The x and y bindings' formats, for non-entity axis labels                                                | [heatmap.md](heatmap.md) header formatting                     |
| `valueFormat`        | The value binding's format                                                                               | [heatmap.md](heatmap.md) printed cell values, fallback tooltip |

The cell lookup is nested rather than a joined string key for the same reason axis data keys are synthetic: x and y come straight from query rows, so any separator in a flat `x|y` key is a character a code or document id can contain, and one datum could alias another. A nested map admits no separator, and the grid walk (`xKeys` × `yKeys`) fits a nested lookup naturally.

Each cell carries: `value` (duplicate (x, y) rows summed, `toNumber`-coerced), `_raw` (first contributing row), `_tooltipNodes` (the chart-level template, as axis rows carry it), `_entityUrl` (`findEntityUrl` over that row). An absent cell is distinct from a zero cell — a code never co-occurring with a document is not the same observation as co-occurring zero times, and the grid renders them differently.

Two deliberate splits. **Labels stay in the renderer**: `xKeys`/`yKeys` are raw ids, and the grid resolves them to pills through the entity map in its tooltip context — the same division ChartTooltip already uses, resolving pills from `_raw` plus the map rather than receiving prebuilt markup. Pills are interactive React with navigation and icons; a pure data function has no business producing them. **The token stays a token**: `resolveRowColor` collapses a color to one hex at shade 9, but the ramp needs the whole shade scale, so the resolver hands over the name and the renderer builds its shade references from it — per [heatmap.md](heatmap.md)'s theming contract, as live CSS variable references, not resolved hex. Passing a single resolved hex here would amputate the ramp.

### The validation obligation

`collectReferencedFields` in `template.ts` feeds `validate.ts`, which rejects specs referencing columns the query does not return. Its rewrite — the complete walk over every family's bindings — is [schema.md](schema.md)'s touch and is enumerated there once. What this contract adds is why the walk must be complete: a binding to a missing column would otherwise validate green and resolve every value to zero, which draws a plausible-looking wrong chart instead of an error — the exact quiet failure this guard exists to prevent.

## Prior art

**Most of `resolve.ts` survives.** Grouping rows by x with first-appearance order (`groupRowsByX`), summing on key collision, the `toNumber` / `toKey` / `toLabel` coercions, `findEntityUrl`'s first-entity-wins scan, per-row color through `resolveRowColor` — `color.ts` is untouched, as the parent spec pins — and chart-level tooltip parsing attached to rows. What dies is the shape around them: the axis branch that reads one y and one series from the spec top level, the parallel `seriesNames` / `seriesColors` pair (replaced by ordered descriptors), the `type` field on the axis renderable, and the matrix stub. The layered resolver is the same grouping pass with an inner loop over layers writing namespaced keys into the same groups.

**The resolver stays hand-rolled.** A dataframe or pivot library (arquero, danfo) was considered and declined. The whole resolver is under two hundred lines, and the repo's posture is plainly against dependencies at this size — the template language, color resolution, and content hashing are all written in-house, and the chart system's runtime dependencies sit at the drawing and formatting edges (recharts, d3-format, react-markdown), never in the data path. More decisively, groupBy-and-pivot is the cheap part: the lines actually go to entity label resolution, color templates evaluated per row, synthetic key assignment, tooltip node attachment, and entity URL discovery — domain logic no pivot library expresses, which would end up wrapped around the library rather than replaced by it.

## Tests

### Skeleton

The resolver's slice of both walking-skeleton stories. Story 1: a spec with a bar layer (`count`) and a line layer (`ratio`, right axis) over `month`, from wide fixture rows, resolves to one row set carrying both keys and two descriptors — distinct keys, marks `bar` and `line`, axes `left` and `right`. Story 2: long fixture rows resolve to a matrix renderable whose `xKeys`/`yKeys` span the 3×2 grid and whose `min`/`max` bracket the cell values.

### Contract

Riskiest first — key uniqueness is the property the layered design stands on, so it is tested before anything a flat port would get right by accident.

> **Given** two layers binding the same y column, **when** resolved, **then** each contributes a descriptor with a distinct key and every row carries both keys with each layer's own summed value.

> **Given** two layers whose descriptors come out with the same display name, **when** resolved, **then** the names are equal, the keys are not, and the descriptor list has two entries — so the legend shows both.

> **Given** a scatter layer with a series column over long rows, **when** resolved, **then** each series' key holds only that series' values, and an x group where a series has no row carries no entry for its key — the redraw-the-first-series bug is unrepresentable.

> **Given** a pivoting layer alongside a plain layer, **when** resolved, **then** the pivoted descriptors and the y-named descriptor coexist in one ordered list over one row set.

> **Given** two single-series bar layers both with `stack: true` on the left axis, **when** resolved, **then** their descriptors share one `stackId` — the wide-format stacked bar, the picture that distinguishes (mark, side) grouping from per-layer grouping.

> **Given** a chart where one bar layer stacks and another layer does not, **when** resolved, **then** the stacking descriptors carry a `stackId` and the others carry none; **given** a stacking bar layer beside a stacking area layer, **then** their `stackId`s differ; **given** two stacking bar layers on opposite axes, **then** their `stackId`s differ too.

> **Given** duplicate rows at the same (x, series), **when** resolved, **then** their values sum — today's aggregation, kept.

> **Given** a layer with a per-row color template, **when** resolved, **then** `_colors` is keyed by the synthetic keys and each datum carries its own row's resolved color.

> **Given** heatmap rows with negative values, **when** resolved, **then** `min` is the true negative minimum and `max` the maximum — the ramp's endpoints are not clamped at zero.

> **Given** heatmap rows that all carry one value, **when** resolved, **then** `min` equals `max` and the renderable is otherwise well-formed — the degenerate ramp is the renderer's problem, but the resolver must not divide by the empty range.

> **Given** heatmap rows covering some (x, y) pairs with one of them valued zero, **when** resolved, **then** the zero pair has a cell with value 0 and the uncovered pairs have no cell at all.

> **Given** duplicate heatmap rows at one (x, y), **when** resolved, **then** the cell's value is their sum.

> **Given** heatmap rows, **when** resolved, **then** `xKeys` and `yKeys` list distinct raw values in order of first appearance, unresolved by the entity map.

> **Given** empty rows, **when** any spec is resolved, **then** nothing throws: an axis chart keeps its non-pivoting descriptors over an empty row set, a matrix has empty key lists, no cells, and no `min`/`max`. The card's empty state usually intercepts zero rows, but the resolver does not get to rely on a caller's guard.

### Isolation

Pure function, no harness. The tests stay table-driven `it.each` cases exactly as `resolve.test.ts` is structured today — a spec, rows, an optional entity map, an assertion — with the fixtures in `test-helpers.ts` rewritten to the layered shape as part of [schema.md](schema.md)'s migration. The only stand-in is `stubResolveRadix`, and it is not a mock: `resolveRadix` is a field of `colorContext`, so the stub is an argument, which is the payoff of keeping the resolver pure.
