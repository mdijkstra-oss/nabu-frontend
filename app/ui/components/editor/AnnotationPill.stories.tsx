import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import type { Code } from "~/domain/data-blocks/callout/codes/selectors"
import { AnnotationPill } from "./FloatingToolbar"

const codes: Code[] = [
  { id: "code-trust", name: "Trust", color: "blue", detail: "Signals of trust" },
  { id: "code-doubt", name: "Doubt", color: "red", detail: "Signals of doubt" },
]

const meta: Meta<typeof AnnotationPill> = {
  title: "Custom/Editor/AnnotationPill",
  component: AnnotationPill,
}

export default meta
type Story = StoryObj<typeof AnnotationPill>

export const Empty: Story = {
  args: { codes: [], onCodeClick: fn() },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getAllByRole("button")[0]
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute("title", "First select codebook entry from sidebar")
  },
}

export const WithCodes: Story = {
  args: { codes, onCodeClick: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getAllByRole("button")[0]
    expect(trigger).toBeEnabled()

    await userEvent.hover(trigger)
    await waitFor(() => {
      expect(canvas.getByText("Trust")).toBeInTheDocument()
      expect(canvas.getByText("Doubt")).toBeInTheDocument()
    })

    await userEvent.click(canvas.getByText("Doubt"))
    expect(args.onCodeClick).toHaveBeenCalledWith("code-doubt")
  },
}
