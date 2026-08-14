export { FALLBACK_COLOR } from "~/lib/chart/color"

export const CHART_HEIGHT = 300

export const CHART_LINE_WIDTH = 2

export const CHART_DOT_RADIUS = 4

export const CHART_BAR_RADIUS = 4

export const CHART_AREA_FILL_OPACITY = 0.9

export const STACKED_BAR_CLASS = "nabu-chart-stacked"

export const HEATMAP_MIN_CELL = 36

export const CHART_MARGIN = { top: 20, right: 12, bottom: 4, left: 4 }

interface PayloadWithEntityUrl {
  _entityUrl?: string
}

interface PayloadWrapper {
  payload?: PayloadWithEntityUrl
}

const unwrapPayload = (clickedDatum: unknown): PayloadWithEntityUrl | undefined => {
  if (!clickedDatum || typeof clickedDatum !== "object") return undefined
  if ("payload" in clickedDatum) {
    const wrapped = (clickedDatum as PayloadWrapper).payload
    if (wrapped) return wrapped
  }
  return clickedDatum as PayloadWithEntityUrl
}

export const buildDatumClickHandler = (
  onDatumClick: ((url: string) => void) | undefined
): ((payload: unknown) => void) | undefined => {
  if (!onDatumClick) return undefined
  return (payload) => {
    const entry = unwrapPayload(payload)
    const url = entry?._entityUrl
    if (url) onDatumClick(url)
  }
}
