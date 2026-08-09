import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, within } from "storybook/test"
import type { Code } from "~/domain/data-blocks/callout/codes/selectors"
import { SelectionToolbarOverlay } from "./FloatingToolbar"

const codes: Code[] = [
  { id: "code-trust", name: "Trust", color: "blue", detail: "Signals of trust" },
]

const FORMATTING_BUTTON_COUNT = 10
const PILL_BUTTON_COUNT = 2

const meta: Meta<typeof SelectionToolbarOverlay> = {
  title: "Custom/Editor/SelectionToolbarOverlay",
  component: SelectionToolbarOverlay,
  decorators: [
    (Story) => (
      <div style={{ position: "relative", width: 640, height: 240 }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof SelectionToolbarOverlay>

const getOverlayRoot = (canvasElement: HTMLElement): HTMLElement => {
  const root = canvasElement.querySelector<HTMLElement>("div[style*='position: absolute']")
  if (!root) throw new Error("overlay root not rendered")
  return root
}

export const CaretOnly: Story = {
  args: {
    selection: { top: 120, centerX: 320, hasRange: false, showAbove: false },
    codes,
    onCodeClick: fn(),
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getAllByRole("button")).toHaveLength(FORMATTING_BUTTON_COUNT)
  },
}

export const RangeBelow: Story = {
  args: {
    selection: { top: 120, centerX: 320, hasRange: true, showAbove: false },
    codes,
    onCodeClick: fn(),
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getAllByRole("button")).toHaveLength(
      FORMATTING_BUTTON_COUNT + PILL_BUTTON_COUNT
    )
    const root = getOverlayRoot(canvasElement)
    expect(root.style.transform).toBe("translate(-50%, 0px)")
    expect(root.style.left).toBe("320px")
    expect(root.style.top).toBe("120px")
  },
}

export const RangeAbove: Story = {
  args: {
    selection: { top: 120, centerX: 320, hasRange: true, showAbove: true },
    codes,
    onCodeClick: fn(),
  },
  play: async ({ canvasElement }) => {
    const root = getOverlayRoot(canvasElement)
    expect(root.style.transform).toBe("translate(-50%, -100%)")
  },
}
