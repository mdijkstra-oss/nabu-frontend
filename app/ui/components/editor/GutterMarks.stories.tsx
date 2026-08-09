import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent } from "storybook/test"
import type { GutterMark } from "~/lib/editor/gutter/types"
import { withSize } from "../../../../.storybook/decorators"
import { GutterMarks } from "./ScrollGutter"

const marks: GutterMark[] = [
  { topPercent: 10, heightPercent: 5, colors: ["blue"] },
  { topPercent: 50, heightPercent: 10, colors: ["red", "green"] },
]

const meta: Meta<typeof GutterMarks> = {
  title: "Custom/Editor/GutterMarks",
  component: GutterMarks,
  decorators: [withSize({ height: "200px" })],
}

export default meta
type Story = StoryObj<typeof GutterMarks>

const getTrack = (canvasElement: HTMLElement): HTMLElement => {
  const track = canvasElement.querySelector<HTMLElement>(".cursor-pointer")
  if (!track) throw new Error("track not rendered")
  return track
}

export const Marks: Story = {
  args: { marks, onScrollTo: fn() },
  play: async ({ canvasElement }) => {
    const track = getTrack(canvasElement)
    const rendered = [...track.children] as HTMLElement[]
    expect(rendered).toHaveLength(2)

    expect(rendered[0].style.top).toBe("10%")
    expect(rendered[0].style.height).toBe("5%")
    expect(rendered[0].style.background).toContain("--blue-9")

    expect(rendered[1].style.top).toBe("50%")
    expect(rendered[1].style.height).toBe("10%")
    expect(rendered[1].style.background).toContain("--red-9")
  },
}

export const ClickToScroll: Story = {
  args: { marks, onScrollTo: fn() },
  play: async ({ canvasElement, args }) => {
    const track = getTrack(canvasElement)

    const rect = track.getBoundingClientRect()
    await userEvent.pointer({
      keys: "[MouseLeft]",
      target: track,
      coords: { clientX: rect.left + 5, clientY: rect.top + rect.height * 0.75 },
    })

    expect(args.onScrollTo).toHaveBeenCalledOnce()
    const percent = (args.onScrollTo as ReturnType<typeof fn>).mock.calls[0][0] as number
    expect(percent).toBeCloseTo(75, 0)
  },
}
