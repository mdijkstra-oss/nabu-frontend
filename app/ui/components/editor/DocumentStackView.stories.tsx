import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { DocumentStackView } from "./DocumentStack"

const front = (
  <div
    data-testid="front-document"
    style={{ height: "100%", background: "white", border: "1px solid #ccc", borderRadius: 12 }}
  >
    Front document
  </div>
)

const meta: Meta<typeof DocumentStackView> = {
  title: "Custom/Editor/DocumentStackView",
  component: DocumentStackView,
  decorators: [
    (Story) => (
      <div style={{ width: 320, height: 200, padding: 24 }}>
        <div style={{ width: "100%", height: "100%" }}>
          <Story />
        </div>
      </div>
    ),
  ],
  args: { front, className: "h-full w-full" },
}

export default meta
type Story = StoryObj<typeof DocumentStackView>

const getShells = (canvasElement: HTMLElement) =>
  within(canvasElement).queryAllByRole("button", { name: "Open selected documents" })

export const NoUnderlying: Story = {
  args: { underlyingCount: 0, onUnderlyingClick: fn() },
  play: async ({ canvasElement }) => {
    expect(getShells(canvasElement)).toHaveLength(0)
    expect(within(canvasElement).getByTestId("front-document")).toBeInTheDocument()
  },
}

export const OneUnderlying: Story = {
  args: { underlyingCount: 1, onUnderlyingClick: fn() },
  play: async ({ canvasElement }) => {
    expect(getShells(canvasElement)).toHaveLength(1)
  },
}

export const TwoUnderlying: Story = {
  args: { underlyingCount: 2, onUnderlyingClick: fn() },
  play: async ({ canvasElement }) => {
    expect(getShells(canvasElement)).toHaveLength(2)
  },
}

export const ManyUnderlyingCappedAtTwo: Story = {
  args: { underlyingCount: 5, onUnderlyingClick: fn() },
  play: async ({ canvasElement, args }) => {
    const shells = getShells(canvasElement)
    expect(shells).toHaveLength(2)

    await userEvent.click(shells[0])
    expect(args.onUnderlyingClick).toHaveBeenCalledOnce()
  },
}
