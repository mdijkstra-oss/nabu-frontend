import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"
import { cdp } from "vitest/browser"
import { withSize } from "../../../../.storybook/decorators"
import { TimelineCard, type TimelineMarker } from "./TimelineCard"
import { EPOCH } from "./fixtures"

const markerRail: Record<TimelineMarker, string> = {
  ask: "bg-brand-700",
  respond: "bg-brand-400",
  plan: "bg-brand-600",
  "step-pending": "bg-neutral-300",
  "step-active": "bg-brand-600",
  "step-done": "bg-success-600",
  "step-cancelled": "bg-neutral-400",
  "step-checkpoint": "bg-brand-700",
  edit: "bg-success-600",
}

const markers = Object.keys(markerRail) as TimelineMarker[]

const meta: Meta<typeof TimelineCard> = {
  title: "Custom/Chat/TimelineCard",
  component: TimelineCard,
  decorators: [withSize({ width: "380px" })],
}

export default meta
type Story = StoryObj<typeof TimelineCard>

const railOf = (container: HTMLElement): Element | null =>
  container.querySelector('span[class*="w-[3px]"]')

// storybook/test's userEvent is synthetic and cannot trigger CSS :hover, and
// pointer input does not reach vitest's scaled tester iframe, so the hover
// state is forced through CDP's CSS.forcePseudoState — the engine then applies
// the real :hover rules. Outside the vitest runner the context module resolves
// to a stub whose exports are null, so the Storybook viewer skips the check.
const forceHover = async (selector: string): Promise<boolean> => {
  if (!cdp) return false
  const session = cdp()
  await session.send("DOM.enable")
  await session.send("CSS.enable")
  await session.send("DOM.getDocument", { depth: -1, pierce: true })
  const { searchId, resultCount } = await session.send("DOM.performSearch", { query: selector })
  expect(resultCount).toBeGreaterThan(0)
  const { nodeIds } = await session.send("DOM.getSearchResults", {
    searchId,
    fromIndex: 0,
    toIndex: 1,
  })
  await session.send("CSS.forcePseudoState", {
    nodeId: nodeIds[0],
    forcedPseudoClasses: ["hover"],
  })
  return true
}

const timestampOf = (container: HTMLElement): Element | null =>
  container.querySelector('span[class*="group-hover"]')

export const MarkerMatrix: Story = {
  render: () => (
    <>
      {markers.map((marker) => (
        <div key={`${marker}-named`} data-testid={`${marker}-named`}>
          <TimelineCard kind={marker.toUpperCase()} marker={marker} timestamp={EPOCH}>
            body
          </TimelineCard>
        </div>
      ))}
      {markers.map((marker) => (
        <div key={`${marker}-null`} data-testid={`${marker}-null`}>
          <TimelineCard kind={null} marker={marker} timestamp={EPOCH}>
            body
          </TimelineCard>
        </div>
      ))}
    </>
  ),
  play: async ({ canvas }) => {
    for (const marker of markers) {
      const named = canvas.getByTestId(`${marker}-named`)
      expect(railOf(named)?.className).toContain(markerRail[marker])
      await expect(within(named).getByText(marker.toUpperCase())).toBeVisible()
      expect(timestampOf(named)).not.toBeNull()

      const bare = canvas.getByTestId(`${marker}-null`)
      expect(railOf(bare)?.className).toContain(markerRail[marker])
      expect(within(bare).queryByText(marker.toUpperCase())).toBeNull()
      expect(timestampOf(bare)).toBeNull()
      expect(bare.textContent).toBe("body")
    }
  },
}

export const HoverRevealsTimestamp: Story = {
  render: () => (
    <div data-testid="hover-card">
      <TimelineCard kind="ANSWER" marker="respond" timestamp={EPOCH}>
        card body
      </TimelineCard>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const timestamp = timestampOf(canvasElement)
    expect(timestamp).not.toBeNull()
    expect(getComputedStyle(timestamp as Element).opacity).toBe("0")
    const hovered = await forceHover('[data-testid="hover-card"] .group')
    if (!hovered) return
    await waitFor(() => expect(getComputedStyle(timestamp as Element).opacity).toBe("1"))
  },
}
