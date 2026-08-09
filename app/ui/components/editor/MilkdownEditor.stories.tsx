import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { withRouter, withSeededFiles } from "../../../../.storybook/decorators"
import { normalizeAsStored } from "~/lib/files/store"
import { MilkdownEditor } from "./MilkdownEditor"

const calloutJson = JSON.stringify({
  id: "code-trust",
  type: "codebook-code",
  title: "Trust",
  content: "Signals of **mutual reliance** between participants.",
  color: "blue",
  collapsed: false,
})

const chartJson = JSON.stringify({
  id: "chart-codes",
  caption: { label: "Codes per month" },
  query: "SELECT month, count FROM codes",
  spec: { type: "bar", x: "month", y: "count", color: "blue" },
})

const kitchenSinkContent = [
  "# Interview Notes",
  "",
  "Some prose about the interview.",
  "",
  "- Themes",
  "\t- Trust building",
  "\t- Reciprocity",
  "",
  "```json-callout",
  calloutJson,
  "```",
  "",
  "```json-chart",
  chartJson,
  "```",
  "",
].join("\n")

const meta: Meta<typeof MilkdownEditor> = {
  title: "Custom/Editor/MilkdownEditor",
  component: MilkdownEditor,
  decorators: [
    withSeededFiles({ "notes.md": kitchenSinkContent }),
    withRouter("/project/demo-project/file/notes.md"),
  ],
}

export default meta
type Story = StoryObj<typeof MilkdownEditor>

export const KitchenSink: Story = {
  args: {
    content: kitchenSinkContent,
    filePath: "notes.md",
    onChange: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const editor = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(".ProseMirror")
      if (!el) throw new Error("ProseMirror not mounted yet")
      return el
    })

    expect(editor.getAttribute("contenteditable")).toBe("true")
    expect(editor).toHaveTextContent("Some prose about the interview.")

    await waitFor(() => {
      const calloutHost = canvasElement.querySelector('[data-id="code-trust"]')
      expect(calloutHost).not.toBeNull()
      expect(calloutHost?.querySelector('[class*="group/callout"]')).not.toBeNull()
      expect(calloutHost?.textContent).toContain("Trust")
    })

    await waitFor(() => {
      const chartHost = canvasElement.querySelector('[data-id="chart-codes"]')
      expect(chartHost).not.toBeNull()
      expect(chartHost?.querySelector('[class*="group/chart"]')).not.toBeNull()
    })

    const prose = within(canvasElement).getByText("Some prose about the interview.")
    await userEvent.click(prose)
    await userEvent.keyboard("typedbyplay")

    await waitFor(() => {
      expect(args.onChange).toHaveBeenCalled()
      const onChange = args.onChange as ReturnType<typeof fn>
      const lastMarkdown = onChange.mock.calls.at(-1)?.[0] as string
      expect(lastMarkdown).toContain("typedbyplay")
      // Canonical markdown is the fixed point of normalizeAsStored; the nested
      // list above serializes differently raw, so skipping canonicalization
      // breaks this equality.
      expect(normalizeAsStored(lastMarkdown)).toBe(lastMarkdown)
    })
  },
}
