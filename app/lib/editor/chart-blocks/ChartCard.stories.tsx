import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { chartFixture, sampleTooltipContext } from "~/lib/chart/test-helpers"
import { withSize } from "../../../../.storybook/decorators"
import { ChartCard, type ChartCardState } from "./ChartCard"
import { CHART_HEIGHT } from "./renderers/shared"

const meta: Meta<typeof ChartCard> = {
  title: "Custom/Charts/ChartCard",
  component: ChartCard,
  decorators: [withSize({ width: "680px" })],
}

export default meta
type Story = StoryObj<typeof ChartCard>

const barFixture = chartFixture("bar")

const readyState: ChartCardState = {
  status: "ready",
  renderable: barFixture.renderable,
  tooltipContext: sampleTooltipContext(),
}

const sampleQuery = "SELECT month, count, region FROM visits"

export const Loading: Story = {
  args: { state: { status: "loading" } },
  play: async ({ canvasElement }) => {
    const placeholder = within(canvasElement).getByText("Loading...")
    expect(placeholder.getBoundingClientRect().height).toBe(CHART_HEIGHT)
  },
}

export const Empty: Story = {
  args: { state: { status: "empty" } },
  play: async ({ canvasElement }) => {
    const placeholder = within(canvasElement).getByText("No data")
    expect(placeholder.getBoundingClientRect().height).toBe(CHART_HEIGHT)
  },
}

export const ErrorState: Story = {
  args: { state: { status: "error", message: "Catalog Error: Table 'visits' does not exist" } },
  play: async ({ canvasElement }) => {
    const placeholder = within(canvasElement).getByText(
      "Catalog Error: Table 'visits' does not exist"
    )
    expect(placeholder.getBoundingClientRect().height).toBe(CHART_HEIGHT)
    expect(placeholder.classList.contains("text-error-700")).toBe(true)
  },
}

export const Ready: Story = {
  args: { state: readyState },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelectorAll("svg .recharts-bar-rectangle").length).toBeGreaterThan(
        0
      )
    })
  },
}

export const ReadyWithQueryResults: Story = {
  args: {
    state: {
      ...readyState,
      queryResults: { rows: barFixture.rows, query: sampleQuery },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText("Query results (6 rows)"))
    expect(canvas.getByText(sampleQuery)).toBeInTheDocument()
    const headers = [...canvasElement.querySelectorAll("th")].map((th) => th.textContent)
    expect(headers).toEqual(Object.keys(barFixture.rows[0]))
  },
}

export const WithCaption: Story = {
  args: {
    state: readyState,
    caption: "Figure 3: Visits by month",
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText("Figure 3: Visits by month")).toBeInTheDocument()
  },
}

export const WithDelete: Story = {
  args: {
    state: { status: "loading" },
    onDelete: fn(),
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button"))
    expect(args.onDelete).toHaveBeenCalledOnce()
  },
}

export const WithoutDelete: Story = {
  args: { state: { status: "loading" } },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole("button")).toBeNull()
  },
}

export const CustomHeight: Story = {
  args: {
    state: { status: "loading" },
    height: 180,
  },
  play: async ({ canvasElement }) => {
    const placeholder = within(canvasElement).getByText("Loading...")
    expect(placeholder.getBoundingClientRect().height).toBe(180)
  },
}
