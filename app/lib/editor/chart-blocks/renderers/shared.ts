export { FALLBACK_COLOR } from "~/lib/chart/color"

export const CHART_HEIGHT = 300

export const CHART_LINE_WIDTH = 2

export const CHART_DOT_RADIUS = 4

export const CHART_BAR_RADIUS = 4

export const CHART_AREA_FILL_OPACITY = 0.9

export const CHART_STACK_ID = "stack"

export const STACKED_BAR_CLASS = "nabu-chart-stacked"

export const CHART_MARGIN = { top: 20, right: 12, bottom: 4, left: 4 }

interface PayloadWithEntityUrl {
  _entityUrl?: string
}

interface PayloadWrapper {
  payload?: PayloadWithEntityUrl
}

const unwrapPayload = (input: unknown): PayloadWithEntityUrl | undefined => {
  if (!input || typeof input !== "object") return undefined
  if ("payload" in input) {
    const wrapped = (input as PayloadWrapper).payload
    if (wrapped) return wrapped
  }
  return input as PayloadWithEntityUrl
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
