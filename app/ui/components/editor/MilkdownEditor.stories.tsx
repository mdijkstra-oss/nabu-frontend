import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { withRouter, withSeededFiles } from "../../../../.storybook/decorators"
import { normalizeAsStored } from "~/lib/files/store"
import { callout } from "~/lib/editor/callout-blocks/fixtures"
import { welcomeContent, welcomePath } from "~/domain/projects/create"
import { tableFixture } from "~/domain/data-blocks/table/test-helpers"
import { MilkdownEditor } from "./MilkdownEditor"

const calloutData = callout("blue")
const calloutJson = JSON.stringify(calloutData)

const chartJson = JSON.stringify({
  id: "chart-codes",
  caption: { label: "Codes per month" },
  query: "SELECT month, count FROM codes",
  spec: { type: "axis", x: "month", layers: [{ mark: "bar", y: "count", color: "blue" }] },
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
}

export default meta
type Story = StoryObj<typeof MilkdownEditor>

export const KitchenSink: Story = {
  decorators: [
    withSeededFiles({ "notes.md": kitchenSinkContent }),
    withRouter("/project/demo-project/file/notes.md"),
  ],
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
      const calloutHost = canvasElement.querySelector(`[data-id="${calloutData.id}"]`)
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

// The seeded welcome document tells the reader some of its text is highlighted, so a
// fuzzy match that stops resolving makes the document itself wrong.
export const SeededWelcome: Story = {
  args: {
    content: welcomeContent,
    filePath: welcomePath,
    onChange: fn(),
  },
  decorators: [
    withSeededFiles({ [welcomePath]: welcomeContent }),
    withRouter(`/project/demo-project/file/${welcomePath}`),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const highlighted = canvasElement.querySelectorAll("[data-annotation-colors]")
      expect(highlighted).toHaveLength(2)
      expect(highlighted[0].textContent).toContain("quotes the passage it answered from")
      expect(highlighted[1].textContent).toContain("it keeps the query rather than the numbers")
    })
  },
}

// Hidden-renderer blocks have no story of their own and the renderer union is
// being extended; this pins that extending it leaves them invisible.
const attributesContent = [
  "# Notes",
  "",
  "Visible prose.",
  "",
  "```json-attributes",
  JSON.stringify({ tags: ["memo"] }, null, "\t"),
  "```",
  "",
].join("\n")

export const HiddenBlock: Story = {
  args: {
    content: attributesContent,
    filePath: "hidden.md",
    onChange: fn(),
  },
  decorators: [
    withSeededFiles({ "hidden.md": attributesContent }),
    withRouter("/project/demo-project/file/hidden.md"),
  ],
  play: async ({ canvasElement }) => {
    const hidden = await waitFor(() => {
      const el = canvasElement.querySelector(".hidden-block")
      if (!el) throw new Error("hidden block not decorated yet")
      return el
    })

    expect(getComputedStyle(hidden).display).toBe("none")
    expect(hidden.getBoundingClientRect().height).toBe(0)
  },
}

// The grid's card-level behavior is pinned by its own stories; what only the real
// editor can show is that a committed cell survives the write-back — the node view
// reconciles instead of re-mounting, so focus stays put and Tab still walks cells.
const tableBlock = tableFixture()

const tableContent = [
  "# Expenses",
  "",
  "Prose above the table.",
  "",
  "```json-table",
  JSON.stringify(tableBlock, null, "\t"),
  "```",
  "",
].join("\n")

export const TableBlock: Story = {
  args: {
    content: tableContent,
    filePath: "expenses.md",
    onChange: fn(),
  },
  decorators: [
    withSeededFiles({ "expenses.md": tableContent }),
    withRouter("/project/demo-project/file/expenses.md"),
  ],
  play: async ({ canvasElement, args }) => {
    const host = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(`[data-id="${tableBlock.id}"]`)
      if (!el) throw new Error("table block not rendered yet")
      return el
    })

    const headers = [...host.querySelectorAll("[data-column-header]")].map((el) =>
      el.textContent?.trim()
    )
    expect(headers).toEqual(tableBlock.columns.map((column) => column.name))

    const cells = () => [...host.querySelectorAll("input")]
    expect(cells()[0]).toHaveValue(tableBlock.rows[0].month)

    await userEvent.click(cells()[0])
    await userEvent.clear(cells()[0])
    await userEvent.type(cells()[0], "2026-03-09")
    await userEvent.tab()

    // Tab commits and lands on the next cell. If the write-back re-mounted the
    // node view instead of reconciling it, focus would be gone by now.
    await waitFor(() => {
      expect(document.activeElement).toBe(cells()[1])
    })

    await waitFor(() => {
      const onChange = args.onChange as ReturnType<typeof fn>
      const markdown = onChange.mock.calls.at(-1)?.[0] as string
      expect(markdown).toContain("2026-03-09")
      expect(markdown).toContain(tableBlock.rows[1].month)
      // The store's canonical form is the fixed point; anything else fires a
      // cursor-resetting replaceAll when the store echoes the write back.
      expect(normalizeAsStored(markdown)).toBe(markdown)
    })
  },
}
