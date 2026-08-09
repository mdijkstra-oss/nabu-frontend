import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { withSize } from "../../../../../.storybook/decorators"
import { CodeItem } from "./CodeItem"
import { sampleCode } from "./fixtures"

const meta: Meta<typeof CodeItem> = {
  title: "Custom/Sidebar/Codes/CodeItem",
  component: CodeItem,
  parameters: {
    layout: "padded",
  },
  decorators: [withSize({ width: "280px" })],
}

export default meta
type Story = StoryObj<typeof CodeItem>

export const Default: Story = {
  args: {
    code: sampleCode,
  },
}

export const Highlighted: Story = {
  args: {
    code: sampleCode,
    highlighted: true,
  },
}

export const WithCount: Story = {
  args: {
    code: sampleCode,
    count: 12,
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText("12")).toBeInTheDocument()
  },
}

export const CompactReviewWarning: Story = {
  args: {
    code: sampleCode,
    reviewStat: { ratio: 0.34, severity: "warning" },
  },
  play: async ({ canvasElement }) => {
    const badge = canvasElement.querySelector("button.text-amber-600")
    expect(badge).not.toBeNull()
  },
}

export const CompactReviewDanger: Story = {
  args: {
    code: sampleCode,
    reviewStat: { ratio: 0.71, severity: "danger" },
  },
  play: async ({ canvasElement }) => {
    const badge = canvasElement.querySelector("button.text-red-600")
    expect(badge).not.toBeNull()
  },
}

export const DebugReviewNormal: Story = {
  args: {
    code: sampleCode,
    debugReview: true,
    reviewStat: { ratio: 0.12, severity: "normal" },
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText("0.12")).toBeInTheDocument()
  },
}

export const DebugReviewWarning: Story = {
  args: {
    code: sampleCode,
    debugReview: true,
    reviewStat: { ratio: 0.34, severity: "warning" },
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText("0.34")).toBeInTheDocument()
  },
}

export const DebugReviewDanger: Story = {
  args: {
    code: sampleCode,
    debugReview: true,
    reviewStat: { ratio: 0.71, severity: "danger" },
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText("0.71")).toBeInTheDocument()
  },
}

export const LongName: Story = {
  args: {
    code: {
      ...sampleCode,
      name: "A very long code name that cannot possibly fit inside a sidebar row",
    },
  },
  play: async ({ canvasElement, args }) => {
    const name = within(canvasElement).getByText(args.code.name)
    expect(name.className).toContain("truncate")
  },
}

export const CountClickStopsPropagation: Story = {
  args: {
    code: sampleCode,
    count: 7,
    onClick: fn(),
    onCountClick: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText("7"))
    expect(args.onCountClick).toHaveBeenCalledTimes(1)
    expect(args.onClick).not.toHaveBeenCalled()
    await userEvent.click(canvas.getByText(sampleCode.name))
    expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}
