export { FALLBACK_COLOR } from "~/lib/chart/color"

export const CHART_HEIGHT = 300

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
