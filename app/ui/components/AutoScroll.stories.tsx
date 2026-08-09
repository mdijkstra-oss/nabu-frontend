import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor } from "storybook/test"
import { AutoScroll } from "./AutoScroll"

const distanceFromBottom = (el: HTMLElement): number =>
  el.scrollHeight - el.scrollTop - el.clientHeight

const AppendHarness = () => {
  const [count, setCount] = useState(20)
  return (
    <div style={{ width: 260 }}>
      <AutoScroll className="h-48 overflow-y-auto rounded-md border border-solid border-neutral-border">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="px-2 py-1 text-body font-body">
            Row {i + 1}
          </div>
        ))}
      </AutoScroll>
      <button type="button" onClick={() => setCount((current) => current + 5)}>
        append
      </button>
    </div>
  )
}

const meta: Meta<typeof AutoScroll> = {
  title: "Custom/Primitives/AutoScroll",
  component: AutoScroll,
  render: () => <AppendHarness />,
}

export default meta
type Story = StoryObj<typeof AutoScroll>

export const AppendPinsToBottom: Story = {
  play: async ({ canvas, canvasElement }) => {
    const container = canvasElement.querySelector(".h-48") as HTMLElement

    await waitFor(() => expect(distanceFromBottom(container)).toBeLessThanOrEqual(1))

    await userEvent.click(canvas.getByText("append"))
    await waitFor(() => expect(distanceFromBottom(container)).toBeLessThanOrEqual(1))
  },
}

export const ScrollUpUnpinsAndShowsButton: Story = {
  play: async ({ canvas, canvasElement }) => {
    const container = canvasElement.querySelector(".h-48") as HTMLElement

    await waitFor(() => expect(distanceFromBottom(container)).toBeLessThanOrEqual(1))

    container.scrollTo({ top: 0 })
    await waitFor(() =>
      expect(canvasElement.querySelector("button.pointer-events-auto")).not.toBeNull()
    )

    await userEvent.click(canvas.getByText("append"))
    await waitFor(() => expect(container.scrollTop).toBeLessThan(50))
    expect(canvasElement.querySelector("button.pointer-events-auto")).not.toBeNull()
  },
}
