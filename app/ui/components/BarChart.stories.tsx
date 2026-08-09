import type { Meta, StoryObj } from "@storybook/react-vite"
import { withSize } from "../../../.storybook/decorators"
import { BarChart } from "./BarChart"

const data = [
  { quarter: "Q1", Interviews: 12, Surveys: 8 },
  { quarter: "Q2", Interviews: 18, Surveys: 11 },
  { quarter: "Q3", Interviews: 9, Surveys: 15 },
  { quarter: "Q4", Interviews: 21, Surveys: 6 },
]

const meta: Meta<typeof BarChart> = {
  title: "Custom/Primitives/BarChart",
  component: BarChart,
  args: {
    data,
    index: "quarter",
    categories: ["Interviews", "Surveys"],
  },
  decorators: [withSize({ width: "480px", height: "320px" })],
}

export default meta
type Story = StoryObj<typeof BarChart>

export const Categorical: Story = {}

export const Stacked: Story = {
  args: { stacked: true },
}
