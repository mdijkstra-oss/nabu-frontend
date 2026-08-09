import { useRef } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor } from "storybook/test"
import { withSize } from "../../../.storybook/decorators"
import { ScrollShadow } from "./ScrollShadow"

const hasTopShadow = (el: HTMLElement): boolean => el.style.boxShadow.includes("0px 10px")
const hasBottomShadow = (el: HTMLElement): boolean => el.style.boxShadow.includes("0px -10px")

const OverflowHarness = () => {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <ScrollShadow scrollRef={scrollRef} className="h-40">
      <div>
        {Array.from({ length: 40 }, (_, i) => (
          <div key={i} className="px-2 py-1 text-body font-body">
            Row {i + 1}
          </div>
        ))}
      </div>
    </ScrollShadow>
  )
}

const meta: Meta<typeof ScrollShadow> = {
  title: "Custom/Primitives/ScrollShadow",
  component: ScrollShadow,
  decorators: [withSize({ width: "240px", className: "flex" })],
  render: () => <OverflowHarness />,
}

export default meta
type Story = StoryObj<typeof ScrollShadow>

export const ScrollTogglesShadows: Story = {
  play: async ({ canvasElement }) => {
    const container = canvasElement.querySelector(".h-40") as HTMLElement

    await waitFor(() => {
      expect(hasTopShadow(container)).toBe(false)
      expect(hasBottomShadow(container)).toBe(true)
    })

    container.scrollTop = 100
    await waitFor(() => {
      expect(hasTopShadow(container)).toBe(true)
      expect(hasBottomShadow(container)).toBe(true)
    })

    container.scrollTop = container.scrollHeight
    await waitFor(() => {
      expect(hasTopShadow(container)).toBe(true)
      expect(hasBottomShadow(container)).toBe(false)
    })
  },
}
