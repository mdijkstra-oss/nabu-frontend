import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { withSize } from "../../../../../.storybook/decorators"
import { CodesSidebar } from "./CodesSidebar"
import { sampleCode } from "./fixtures"
import type { Codebook } from "./types"

const sampleCodebook: Codebook = {
  categories: [
    {
      fileId: "interviews",
      name: "Interviews",
      codes: [
        sampleCode,
        { id: "trust", name: "Trust", color: "teal", detail: "Expressions of reliance." },
        { id: "conflict", name: "Conflict", color: "red", detail: "Disagreement between parties." },
      ],
    },
  ],
}

const tallCodebook: Codebook = {
  categories: [
    {
      fileId: "codebook",
      name: "Codebook",
      codes: Array.from({ length: 40 }, (_, i) => ({
        id: `code-${i}`,
        name: `Code ${i}`,
        color: "blue",
        detail: "",
      })),
    },
  ],
}

const meta: Meta<typeof CodesSidebar> = {
  title: "Custom/Sidebar/Codes/CodesSidebar",
  component: CodesSidebar,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withSize({ height: "100vh" })],
}

export default meta
type Story = StoryObj<typeof CodesSidebar>

export const NewCodeButton: Story = {
  args: {
    codebook: sampleCodebook,
    onNewCode: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const button = canvasElement.querySelector("svg.lucide-plus")?.closest("button")
    expect(button).not.toBeNull()
    if (button) await userEvent.click(button)
    expect(args.onNewCode).toHaveBeenCalledTimes(1)
  },
}

export const Selection: Story = {
  args: {
    codebook: sampleCodebook,
    selectedCodeIds: new Set(["trust"]),
    onToggleCode: fn(),
  },
  play: async ({ canvasElement, args }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-code-id="trust"] svg.lucide-check')).not.toBeNull()
      expect(canvasElement.querySelector('[data-code-id="empathy"] svg.lucide-check')).toBeNull()
    })
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText("Empathy"))
    expect(args.onToggleCode).toHaveBeenCalledTimes(1)
    expect(args.onToggleCode).toHaveBeenCalledWith("empathy")
  },
}

export const AutoScroll: Story = {
  args: {
    codebook: tallCodebook,
    selectedCodeIds: new Set(["code-37", "code-38"]),
  },
  decorators: [withSize({ height: "360px" })],
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const container = canvasElement.querySelector(".overflow-auto")
      if (!(container instanceof HTMLElement)) throw new Error("no scroll container rendered")
      expect(container.scrollHeight).toBeGreaterThan(container.clientHeight)
      expect(container.scrollTop).toBeGreaterThan(0)
      const row = container.querySelector('[data-code-id="code-38"]')
      if (!(row instanceof HTMLElement)) throw new Error("selected row not rendered")
      const containerRect = container.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      expect(rowRect.top).toBeGreaterThanOrEqual(containerRect.top)
      expect(rowRect.bottom).toBeLessThanOrEqual(containerRect.bottom)
    })
  },
}

export const FlyOut: Story = {
  args: {
    codebook: sampleCodebook,
    globalAnnotationCounts: { empathy: { count: 4, fileCount: 2 } },
    onSearchCode: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(canvas.getByText("Empathy"))
    await waitFor(() => {
      expect(canvas.getAllByText("Empathy")).toHaveLength(2)
      expect(canvas.getByText("Definition")).toBeInTheDocument()
      expect(canvas.getByText("4")).toBeInTheDocument()
    })
    await userEvent.click(canvas.getByText("4"))
    expect(args.onSearchCode).toHaveBeenCalledWith(expect.objectContaining({ id: "empathy" }))
  },
}
