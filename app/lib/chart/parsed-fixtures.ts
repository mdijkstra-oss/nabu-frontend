import { parseChart } from "~/domain/data-blocks/chart/schema"
import { resolveRadixHex } from "~/ui/theme/radix"
import { CHART_COLOR_SHADE, FALLBACK_COLOR, type ColorContext } from "./color"
import { resolveChartData } from "./resolve"
import type { ChartEntityMap, RenderableChart } from "./types"
import { chartFixture, narrowRenderable, type ChartFixtureName } from "./test-helpers"

// For stories, which render in a browser where the Radix variables resolve.
export const storyColorContext = (entityMap: ChartEntityMap = {}): ColorContext => ({
  entityMap,
  resolveRadix: resolveRadixHex,
  shade: CHART_COLOR_SHADE,
  fallback: FALLBACK_COLOR,
})

// Walking-skeleton path only: fixtures run through the real parser and
// resolver. Contract stories hand renderers literals from test-helpers instead,
// which is why this lives in its own module — importing it means importing the
// resolver.
export const resolveFixtureThroughSchema = <K extends RenderableChart["kind"]>(
  name: ChartFixtureName,
  kind: K
): Extract<RenderableChart, { kind: K }> => {
  const { spec, rows } = chartFixture(name)
  const block = parseChart(
    JSON.stringify({ id: "chart1", caption: { label: name }, query: "SELECT 1", spec })
  )
  if (!block) throw new Error(`${name} fixture failed to parse`)
  return narrowRenderable(
    resolveChartData({ spec: block.spec, rows, entityMap: {}, colorContext: storyColorContext() }),
    kind
  )
}
