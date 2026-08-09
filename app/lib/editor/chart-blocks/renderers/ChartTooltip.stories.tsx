import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import { sampleTooltipContext, sampleTooltipPayload } from "~/lib/chart/test-helpers"
import { parseTemplate } from "~/lib/chart/template"
import { ChartTooltip } from "./ChartTooltip"

const meta: Meta<typeof ChartTooltip> = {
  title: "Custom/Charts/ChartTooltip",
  component: ChartTooltip,
}

export default meta
type Story = StoryObj<typeof ChartTooltip>

export const Templated: Story = {
  args: {
    context: sampleTooltipContext(),
    active: true,
    label: "Jan",
    payload: sampleTooltipPayload({
      payload: {
        _raw: { month: "Jan", count: 12 },
        _tooltipNodes: parseTemplate("Month {month} saw {count} visits"),
      },
    }),
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText("Month Jan saw 12 visits")).toBeInTheDocument()
  },
}

export const Fallback: Story = {
  args: {
    context: sampleTooltipContext(),
    active: true,
    label: "Jan",
    payload: [
      ...sampleTooltipPayload({ name: "count", value: 12 }),
      ...sampleTooltipPayload({ name: "total", value: 31 }),
    ],
  },
  play: async ({ canvasElement }) => {
    const header = canvasElement.querySelector("strong")
    expect(header?.textContent).toBe("Jan")
    const lines = [...canvasElement.querySelectorAll("li")].map((li) => li.textContent)
    expect(lines).toEqual(["count: 12", "total: 31"])
  },
}

export const Inactive: Story = {
  args: {
    context: sampleTooltipContext(),
    active: false,
    label: "Jan",
    payload: sampleTooltipPayload(),
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toBe("")
  },
}

export const EmptyPayload: Story = {
  args: {
    context: sampleTooltipContext(),
    active: true,
    payload: [],
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toBe("")
  },
}
