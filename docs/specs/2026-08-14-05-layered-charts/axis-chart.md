# Axis chart

`AxisChart.tsx` today is four chart components behind one dispatch: `renderBar`, `renderLine`, `renderArea`, `renderScatter`, switched on the renderable's `type`. That switch is why a line cannot draw over bars — Recharts composes marks inside one chart element, and four separate `BarChart`/`LineChart`/`AreaChart`/`ScatterChart` elements can never share a coordinate system. This component collapses the four into one `ComposedChart` that walks the renderable's series descriptors and emits one mark element per descriptor. The renderable is [resolver.md](resolver.md)'s contract and is not restated here; what this file owns is how a descriptor becomes a mark, and the rules — stacking, sides, orientation, legend — that only exist once marks share a chart.

The collapse also fixes a real bug, not just a limitation. Today's scatter binds the y-axis to `seriesNames[0]` and hands every `Scatter` the whole row set, so a second scatter series redraws the first series' values. With one mark per descriptor, each `Scatter` binds its own `dataKey` and the y-axis binds no series at all; the fix falls out of the structure, and a story pins it so it cannot regress.

## Contract

### Props

The props are unchanged from today's `AxisChart`, because its one consumer is unchanged: `dispatch.tsx` renders `<AxisChart>` for the `"axis"` kind, forwarding what `ChartCard` gave it.

- `renderable` — the axis renderable from [resolver.md](resolver.md): merged rows, ordered series descriptors (each carrying a unique data key, display name, mark, resolved color, stack id, y-axis side), orientation, the x format and per-side value formats, and bands. It arrives fully resolved; this component reads it and never computes colors, keys, or sides itself.
- `tooltipContext` — passed through to `buildChartTooltipContent`, which needs the file store, entity map, and navigate function to render template markdown with entity pills. The tooltip component is untouched by this feature.
- `onDatumClick` — optional; `ChartCard` supplies navigation to a datum's `_entityUrl`. Optional because stories and read-only contexts render charts with nothing to navigate.
- `height` — optional, defaulting to `CHART_HEIGHT`; `ChartCard` overrides it where layout demands.

### One mark per descriptor

The component renders a single `ComposedChart` over `renderable.rows`. Each series descriptor becomes, in order, exactly one direct child: `Bar`, `Line`, `Area`, or `Scatter` per its mark, bound to the descriptor's data key, colored with its resolved color, bound via `yAxisId` to its side, and carrying the descriptor's display name as its `name` prop. The `name` binding is the obligation [resolver.md](resolver.md)'s synthetic keys impose: the legend and the tooltip fallback read the mark's `name` (falling back to the `dataKey`), so a mark without it leaks `l0s0` into user-facing text. Descriptor order is z-order — later layers draw over earlier ones — which is why the resolver's ordering is part of its contract and this component must not reorder.

Mark styling carries over from the four functions it replaces: lines and area strokes at `CHART_LINE_WIDTH` with `CHART_DOT_RADIUS` dots, areas at `CHART_AREA_FILL_OPACITY`, bars with `CHART_BAR_RADIUS` rounding on the value end. Bar marks render per-datum `Cell` children from the row's `_colors` map keyed by the descriptor's data key, falling back to the series color — the mechanism that lets a one-layer bar chart color each bar by the entity it names. Bar and scatter marks take the click handler from `buildDatumClickHandler` and a pointer cursor when `onDatumClick` is present; line and area do not, exactly as today, because their hit targets are strokes and fills a user does not read as clickable rows.

Marks are emitted as flat arrays of direct children, never wrapped in fragments: Recharts scans a chart's direct children for axes and marks through its bundled react-is 18, which does not recognize React 19 fragment elements. The comment in today's `renderBar` carries into the `ComposedChart` build verbatim — this constraint is the one most likely to be "cleaned up" into a silent blank chart.

### Stacking

Each descriptor's `stackId` passes to the Recharts mark verbatim — series sharing an id form a stack, and this component never derives, adjusts, or second-guesses the id. The grouping rule (by mark and axis side, so bars never stack onto areas and a left stack never merges with a right one) is [resolver.md](resolver.md)'s contract, stated and argued there once.

Per that contract a `stackId` appears only on bar and area descriptors — the schema cannot parse `stack` onto a line or scatter layer, so no in-contract renderable presents one and this component carries no defensive branch for it.

Stacked bars render square (`[0,0,0,0]` radius) with the `nabu-chart-stacked` class for the white seam stroke, as today. Rounding only the topmost segment of a stack was considered and is not done: which segment is topmost varies per row when values hit zero, so it needs a per-cell computation over the data for a purely cosmetic gain. Square stacks are the shipped rule.

### Two y-axes

A left `YAxis` always renders. A right `YAxis` (`yAxisId: "right"`, orientation right) renders only when at least one descriptor claims side `"right"`; a chart with no right-side series has no right axis, no reserved right gutter, nothing. Every mark binds `yAxisId` to its descriptor's side; left is the default side and the resolver guarantees every descriptor carries one.

Tick formatting is per side: each axis applies the format the renderable carries for it — `leftAxisFormat` and `rightAxisFormat`, whose derivation is [resolver.md](resolver.md)'s contract. Both axes render with `axisLine` and `tickLine` off, ticks styled by `chart.css`, as every axis today does.

### Orientation

`"vertical"` is the default: bars rise, categories on the x axis. `"horizontal"` puts categories on the y screen axis — which Recharts, confusingly, calls `layout="vertical"`. That vocabulary inversion is today confined to `renderBar` and stays confined here: the renderable says `horizontal`/`vertical` in the user's sense, this component translates once, and nothing outside it ever sees a Recharts layout string.

Horizontal orientation is honored only when every descriptor's mark is `bar`. A chart with any line, area, or scatter layer renders vertical regardless of what the spec says. The schema keeps orientation chart-level and unrestricted, so this is the renderer degrading rather than the parser rejecting — deliberately: Recharts draws lines and areas incoherently under `layout="vertical"` with a category y-axis, and a chart that renders readably in the wrong orientation beats one that renders garbage in the right one or refuses to parse at all. The rule is a single predicate over the descriptor list, and a story pins the degradation so it is a documented behavior, not an accident.

In horizontal orientation, side claims collapse: all marks bind the single value axis and no right axis renders. Horizontal is bars-only, and a second value axis for an all-bar chart over one categorical dimension is not a picture this feature needs; stating the collapse here keeps the corner from becoming an undefined behavior. The collapsed axis's ticks apply `leftAxisFormat`, falling back to `rightAxisFormat` when only right-side layers declared one — a schema-legal all-bar chart may claim only the right side, and the collapse must not strand its format.

### Grid, bands, tooltip, legend, height

`CartesianGrid` renders value-axis lines only (horizontal lines in vertical orientation, vertical lines in horizontal) — as today's bar, line, and area charts do. Today's scatter renders gridlines in both directions; under the unified rule a chart containing scatter layers keeps value-axis lines only. That is a deliberate visible change, not an oversight: one composed chart gets one grid rule, and a carried-over scatter story must pin the new picture. Bands render as `ReferenceArea` children from the renderable's chart-level `bands` — bands belong to the chart, not a layer, so they span all marks. A band marks a category range, so it binds to whichever screen axis carries the category binding: x1/x2 in vertical orientation, y1/y2 in horizontal. The label and the dashed styling from `chart.css` are unchanged. One chart-level `Tooltip` takes its content from `buildChartTooltipContent(tooltipContext)` — one tooltip for the whole composed chart means a hover shows every layer's value at that x, which is the point of composing them, and the fallback list in `ChartTooltip` already renders exactly that.

The legend renders `ChartLegend` when the total series count across all layers exceeds one. One series needs no legend — the caption names it; two series from one layer, or one series from each of two layers, both need one, so the threshold counts descriptors, not layers.

The chart mounts in a `ResponsiveContainer` with class `nabu-chart`, width 100%, height from the prop or `CHART_HEIGHT`. All constants stay in `shared.ts`.

## Prior art

**The four render functions are the prior art, and most of their flesh survives.** The axis configuration (`axisLine`/`tickLine` off, `tickFormatterFor` over `formatValue`), `renderBands`, `barRadius`, `buildDatumClickHandler`, the `Cell`/`_colors` mechanism, `renderLegend`'s threshold, and the constants in `shared.ts` move into the one component intact — except `CHART_STACK_ID`, which dies: stack ids now arrive on descriptors and are consumed verbatim, so a renderer-owned stack constant has no consumer left. What dies is the dispatch: `renderByType`, the `AxisChartType` switch, and the three type strings (`bar`/`stacked-bar`/`grouped-bar`) that encoded stacking as a chart type instead of a series property. The scatter function's y-axis binding dies unmourned — it is the bug.

**`ComposedChart` is the vehicle because it is the Recharts answer to exactly this problem**: it accepts `Bar`, `Line`, `Area`, and `Scatter` as siblings over one row set, one grid, shared axes with `yAxisId` routing, and one tooltip. Everything the four separate chart components did, it does; what they could not do — mixed marks, a second axis — is its reason to exist. The alternative of keeping four components and adding a fifth "combo" one was rejected as five copies of the axis scaffolding instead of one.

**Not a different chart library.** Recharts is installed, themed through `chart.css` variables, and the tooltip and legend machinery (`ChartTooltip`, `ChartLegend`) is built against its content-component protocol; a library swap would reopen all of that to fix a problem `ComposedChart` already solves.

## Tests

Stories are the test layer — per `AGENTS.md`, UI work is stories-first, run headless through the storybook vitest project under `npm test`. The existing `AxisChart.stories.tsx` assertions are behavior pins, re-expressed against the new renderable, not relaxed.

### Skeleton

This component's slice of the walking skeleton is spec.md's first story: a bar layer (`count`) and a line layer (`ratio`, right axis) over the same `month` x, driven by a spec JSON through the real `parseChart` and resolver. Green here means a `ComposedChart` draws both marks together and the right axis exists with its own scale — before any of the contract stories below are deepened.

### Contract

Riskiest first — the scatter fix, then the rules that only exist because marks now share a chart, then the carried-over pins.

> **Given** a renderable with two scatter series whose y values differ per row, **when** rendered, **then** each series' symbols sit at its own values — the symbol positions for the second series differ from the first's. This is the pin on the bug: today both series draw the first series' values.

> **Given** a renderable where one descriptor claims side `"right"`, **when** rendered, **then** a second y-axis appears on the right with ticks in the right-side format; **given** no descriptor claims it, **then** exactly one y-axis renders.

> **Given** a renderable whose bar descriptors share one `stackId` and whose area descriptors share a different one, **when** rendered, **then** the bars' domain reflects only the bar values — the two stacks do not merge into one sum. And **given** two single-series bar descriptors sharing one `stackId` (the wide-format stacked bar), **then** their rectangles stack into one column per x.

> **Given** two area series with `stack` set, **when** rendered, **then** the y domain exceeds the tallest single series (the existing Area story's sum pin, now expressed through the explicit stack flag); **given** the same two series without `stack`, **then** the domain tops out at the tallest series — overlay, not stack.

> **Given** a horizontal chart whose layers are all bars, **when** rendered, **then** category labels appear on the y axis (the existing `VerticalBar` pin, renamed to the new vocabulary); **given** a horizontal chart with a line layer, **then** it renders in vertical orientation — the degradation rule made visible.

> **Given** two bar series with `stack` set, **when** rendered, **then** six rectangles occupy three distinct horizontal positions; **given** the same two without `stack`, **then** six positions — the `StackedBar`/`GroupedBar` pins, re-expressed as one layer with a series column and the stack flag flipped.

> **Given** the banded fixture, **when** rendered, **then** one reference area renders and its label text appears — carried over.

> **Given** a bar whose row carries `_entityUrl` and an `onDatumClick` handler, **when** the bar is clicked, **then** the handler receives the URL and the bar showed a pointer cursor; without the handler, no pointer — the `DatumClick` and `Bar` pins, unchanged, preserving the behavior spec.md singles out.

> **Given** a bar layer and a line layer, **when** rendered, **then** both a bar rectangle and a line curve exist in one SVG, and the legend lists both series — the combo case as an isolated story, distinct from the skeleton's full-path version.

> **Given** a one-series renderable, **then** no legend; **given** two series from any combination of layers, **then** the legend renders both entries — and the entries read the descriptors' display names, never a synthetic key like `l0s0`. The same holds for the fallback tooltip's series lines; the two-descriptors-same-display-name case (pinned on the resolver side by its own test) shows the name twice here, distinguished only by value.

> **Given** a renderable containing a scatter descriptor, **when** rendered, **then** gridlines run in the value direction only — the deliberate change from today's both-direction scatter grid, pinned so an implementation cannot quietly keep the old picture.

> **Given** the `height` prop, **then** the laid-out container matches it; absent, it is `CHART_HEIGHT` — the `ExplicitHeight` and `Bar` height pins, unchanged.

### Isolation

Every contract story hands the component a hand-built renderable conforming to [resolver.md](resolver.md)'s contract — no story imports the resolver. That is what keeps the seam swappable: the renderer is proven against the contract, the resolver is proven to emit it, and neither test suite breaks when the other's internals move. The renderable fixtures these stories consume are **literal objects, specified by this file** — today's `renderableOfKind` builds renderables by calling `resolveChartData`, and that construction is replaced, because a resolver-backed fixture makes every renderer story transitively a resolver test. The literals live in `test-helpers.ts` beside [schema.md](schema.md)'s spec-and-row fixtures (that file owns those; the renderable literals are owned here and in [heatmap.md](heatmap.md) for the matrix ones), with `sampleTooltipContext` carried over; stories needing a shape the shared literals do not cover (two scatter series, a right-side claim) build descriptors inline. The one exception is the skeleton story, which deliberately runs the full parse-resolve-render path — its job is the seam itself.
