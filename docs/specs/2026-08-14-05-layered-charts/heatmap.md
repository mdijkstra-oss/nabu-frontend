# Heatmap

`HeatmapPlaceholder.tsx` renders the words "Too cold for heatmap" at chart height. This component replaces it with the real thing: a code × document co-occurrence grid, which is the view qualitative coders reach for first — every document as a column, every code as a row, each cell saying how often that code lands in that document, darker meaning more.

It is an HTML/CSS grid, not a Recharts chart and not hand-drawn SVG. Recharts has no heatmap primitive, so it buys nothing here; and the axis labels of a co-occurrence matrix are entity ids — codes and documents — that must render as the same clickable pills the rest of the app uses. Pills are React components, which HTML hosts for free and SVG hosts only through `foreignObject` contortions. The grid is the medium in which every requirement of this component is cheap.

## Contract

### The outer shape

The component is `Heatmap` in `app/lib/editor/chart-blocks/renderers/Heatmap.tsx`, and it takes exactly the props the other renderers take, so `dispatch.tsx` stays a dumb switch that now passes all four through on the `matrix` case instead of only `height`:

- `renderable` — the matrix renderable
- `tooltipContext` — the same `ChartTooltipContext` the axis and part charts receive
- `onDatumClick` — optional, `(url) => void`
- `height` — optional, defaulting to `CHART_HEIGHT` from `shared.ts`

Side effects: none beyond calling `onDatumClick` and the pills' `navigate`. Hover state — which cell the tooltip is anchored to — is internal component state and never leaves.

### What it reads

The matrix renderable is owned by [resolver.md](resolver.md) and its shape is not restated here. What this renderer consumes from it: the ordered x labels, the ordered y labels, cells addressed by (x, y) — each carrying the summed value, `_raw`, `_tooltipNodes` and an optional entity url — the `min` and `max` over present cells, the spec's Radix token, and the formats: `xFormat`/`yFormat` for non-entity axis labels and `valueFormat` for printed cell values. The renderer never looks at rows or the spec; a (x, y) pair with no cell is simply absent, and absence is meaningful (below).

### The ramp

Cell color maps the value onto shades of the one Radix token, linearly from `min` to `max` over **shades 3 through 9**: `shade = 3 + round((value − min) / (max − min) × 6)`. The range is a judgement with reasons at both ends. The floor is 3, not 1 or 2, because shades 1–2 are Radix's app and subtle backgrounds — a cell painted there is indistinguishable from an empty one, and the whole point of the floor is that the smallest present value still visibly _is_ a value. The ceiling is 9 because that is the token's solid color — the same `CHART_COLOR_SHADE` every other chart paints with, so a heatmap's hottest cell and a bar chart's bars in the same token agree — and because shades 10–12 are text colors that drift off-hue.

The mapping is linear and sign-blind: negative values are legal and simply occupy the low end of the ramp. Cross-tabs of averages or deltas produce them, and inventing a diverging palette for one Radix token is not this component's job.

**Degenerate case:** when `min === max` — a one-cell matrix, or a matrix where every co-occurrence count is the same — every present cell gets shade 9. A uniform matrix is a statement that everything present is equally hot, and shade 9 is the family's canonical chart color, so a single-valued heatmap looks like the rest of the system rather than washed out at an arbitrary midpoint.

### Missing is not zero

A cell with value 0 is a finding: the code was looked for in that document and the count is zero. A missing (x, y) pair is no finding at all — the query returned no row. The two must not look alike. A zero-valued cell gets its ramped shade (shade 3 when 0 is the minimum) and prints "0". A missing cell gets **no ramp color at all** — the card's own background shows through — and prints nothing. Because the ramp floor is 3, the tinted zero and the untinted absence are separable at a glance, which is why the floor could not be 2.

### Printed values and their contrast

Values print inside cells. A qualitative coder reads counts, not just relative darkness — "grief appears 14 times in interview 3" is the datum, the shade is the overview. Printed values use the caption typography and tabular numerals the chart tick styles already prescribe, and are formatted through the same `format.ts` formatter axis ticks use when the renderable carries a `valueFormat` — the value binding's format, delivered by [resolver.md](resolver.md), because this renderer never reads the spec.

Contrast is kept by a rule that needs no luminance computation: cells at shades 3–7 print their value in **step 12** of the same token, cells at shades 8–9 print in **step 1**. Steps 12 and 1 are the two extreme ends of the scale, and both move with the theme through the same CSS variables the background does — dark-on-tint and light-on-solid in light mode become light-on-tint and dark-on-solid in dark mode without a line of theme-aware code.

### Theming goes through the variables, not snapshots

Cell backgrounds and value text are `var(--{token}-{shade})` references — the same variables `resolveRadixHex` reads. They are used as live `var()` references rather than resolved to hex, because that resolution exists for Recharts' SVG props, which cannot consume CSS variables; HTML backgrounds can, and a live reference follows a theme flip without a re-render. No hex is ever hardcoded. Grid gaps, axis label text and the empty-cell ground use the existing `--color-chart-grid` / `--color-chart-tick` / `--color-chart-surface` variables via new `.nabu-chart-heatmap` rules in `app/styles/chart.css`, beside the rules the Recharts family already keeps there.

### Axis labels are pills when they are entities

An axis label whose value is a key in the entity map renders as the same clickable pill tooltips use: the label becomes a one-link markdown fragment (`[label](file://id)`) rendered through `createEntityLinkComponents` with the `files`, `projectId` and `navigate` already sitting in `tooltipContext`. That route — not a second pill implementation — is the contract: pill resolution, missing-ref handling and click-to-navigate stay defined in exactly one module. A label that is not an entity id (a month, a category string) renders as plain text in the tick style, passed through the renderable's `xFormat` or `yFormat` when one is present — so a date axis reads "Apr 1912", not a raw key; entity labels ignore the formats, since an id is not a formattable value. In the co-occurrence use case both axes are typically entities — codes down the side, documents across the top — which is why pills are a requirement and not a flourish.

### Tooltip

Hovering a present cell shows the chart tooltip. The mechanism: the component tracks the hovered cell in state and renders `ChartTooltip` **directly** — the same component, the same `tooltipContext` — with a synthetic props object shaped like `RechartsTooltipContentProps`: `active` true, `label` set to the x label, and a single payload item whose `name` is the y label, whose `value` is the cell's value, and whose `payload` carries the cell's `_raw` and `_tooltipNodes`. It floats in a positioned wrapper anchored to the hovered cell inside the grid's container, clamped so it never escapes the card.

Because the synthetic props are shape-identical to what Recharts feeds the axis charts, the template behavior is identical by construction: a spec with a `tooltip` template resolves it against `_raw` and the entity map, pills and all; a spec without one falls into `ChartTooltip`'s existing fallback, which for the synthetic payload reads as the x label bold, then "y label: value" — exactly the three facts a cell is. Two resolutions happen on the way in: where an axis value is an entity id, the synthetic `label` and `name` carry the entity's resolved label, not the raw id, so the fallback names "Interview 3", never `file:abc123`; and the synthetic `value` is pre-formatted through `valueFormat` when the renderable carries one, because `ChartTooltip`'s fallback stringifies whatever it receives — the tooltip must show the same text the cell prints. Missing cells get no tooltip; there is no datum to describe.

### Click

Clicking a cell that carries an entity url calls `onDatumClick` with it — the same prop, the same navigation, as the parent spec's preserved-behavior claim demands for bars. The click routes through `buildDatumClickHandler` from `shared.ts` with the cell as payload, so "navigate only when an entity url exists" stays one rule in one place. Cells with an entity url show a pointer cursor when `onDatumClick` is provided, mirroring what `AxisChart.stories.tsx` pins for bars; cells without one, and all cells when the prop is absent, do not.

### Overflow

Many documents × many codes must not break the card. The rule: cells have a fixed minimum size (a shared constant beside `CHART_HEIGHT`), the grid area is capped at `height`, and when the matrix outgrows the card in either direction the grid **pans inside the card** — one scroll container, both axes. The y label column is sticky at the left edge and the x label row is sticky at the top, painted on the card background, so a coder scrolled deep into a wide corpus never loses which code and which document a cell belongs to. When the matrix is small, columns share the available width equally down to the minimum, so the walking skeleton's 3×2 fills the card rather than huddling in a corner. Cells are never crushed below the minimum to force a fit — a crushed cell can neither print its value nor be hovered with intent.

## Prior art

**Replaced:** `app/lib/editor/chart-blocks/renderers/HeatmapPlaceholder.tsx` and its stories file. The `matrix` case in `dispatch.tsx` — currently the one case that drops every prop but `height` — becomes symmetric with its siblings.

**Reused, untouched:** `ChartTooltip` (`renderers/ChartTooltip.tsx`) rendered directly with a synthetic Recharts-shaped payload — its template resolution, fallback list and pill rendering are the pinned behavior the parent spec forbids changing, and driving it from HTML hover instead of Recharts is precisely what its props shape allows. `createEntityLinkComponents` (`app/ui/components/markdown/`) is the pill machinery for axis labels. `buildDatumClickHandler` and `CHART_HEIGHT` come from `renderers/shared.ts`. The `--{token}-{shade}` variables are the ones `resolveRadixHex` already reads; the `--color-chart-*` variables are the ones `chart.css` already spends.

**Why not Recharts or SVG:** Recharts has no heatmap primitive, so it contributes nothing, and pills are React components that HTML hosts natively while SVG does not.

**Why no heatmap library:** a heatmap is a colored CSS grid — a dependency would buy the easy part while still leaving pills, `ChartTooltip` integration and the Radix ramp to be built by hand around it.

## Tests

Stories are the test layer, per this repository's stories-first rule: `Heatmap.stories.tsx` under `Custom/Charts/Heatmap`, `withSize` decorator and play functions in the house style of `AxisChart.stories.tsx`, running headless through the storybook vitest project in `npm test`.

### Skeleton

Item 2 of the walking skeleton: a 3×2 code × document grid whose spec JSON goes through the real `parseChart` and `resolveChartData` — not a hand-built renderable — proving the schema accepts the heatmap shape, the resolver produces a matrix renderable with labels and cells, the ramp maps values to shades, and the grid renders in the story runner.

### Contract

Riskiest first — the ramp's edge cases, then the semantic distinctions, then the machinery already proven elsewhere.

> **Given** a matrix where every cell holds the same value, **when** it renders, **then** every present cell is painted at shade 9 of the token and none is unpainted.

> **Given** cells with values −5, 0 and 5 and a min/max of −5/5, **when** they render, **then** −5 sits at shade 3, 5 at shade 9, and the mapping between is linear — the sign changes nothing.

> **Given** a matrix with a zero-valued cell and an absent (x, y) pair, **when** it renders, **then** the zero cell carries a ramp background and prints "0" while the absent cell carries no ramp background and prints nothing — the two are visually distinct.

> **Given** a y label that is an entity id in the entity map, **when** the grid renders, **then** the label is a pill showing the entity's label, and clicking it navigates to the entity's url.

> **Given** an x label that is no entity id, **when** the grid renders, **then** it is plain text — no pill, no anchor.

> **Given** a cell carrying an entity url and an `onDatumClick`, **when** the cell is clicked, **then** `onDatumClick` receives that url — and the cell shows a pointer cursor before the click, as `DatumClick` pins for bars.

> **Given** a cell whose `_tooltipNodes` come from a template naming an entity field, **when** the cell is hovered, **then** the tooltip renders the template's markdown with the entity as a pill — identical to the axis charts' template behavior.

> **Given** a renderable with no tooltip template and a `valueFormat`, **when** a cell is hovered, **then** the fallback tooltip shows the x label, the y label and the **formatted** value — the same text the cell prints — with entity ids replaced by their resolved labels.

> **Given** a matrix of 30 documents × 20 codes, **when** it renders at default height, **then** the card's own layout does not widen, the grid pans within it, and the y label column stays visible while scrolled horizontally.

> **Given** an explicit `height` of 220, **when** the grid renders, **then** the laid-out component height is 220 — the same pin `ExplicitHeight` holds for the axis chart.

### Isolation

Contract stories take hand-built matrix renderables conforming to [resolver.md](resolver.md)'s contract — the fixture builder lives in `test-helpers.ts` beside the existing ones — with entity maps stubbed through the existing `entity()` helper and tooltip context through `sampleTooltipContext()`. Hand-building is what makes the edge cases expressible: a uniform matrix, a negative range or a deliberately absent cell is one literal, not a query contrived to produce it. Only the skeleton story runs the parsed path, and that split is deliberate — the skeleton proves the pipeline holds together, the contract stories probe this renderer's own rules without the resolver's behavior in the frame. No story makes a database or model call.
