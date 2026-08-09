import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import type { Annotation } from "~/domain/data-blocks/attributes/annotations/selectors"
import { HighlightTooltip, type HighlightEntry } from "~/ui/components/HighlightTooltip"
import { annotationToEntry } from "./AnnotationHover"

const annotations: Annotation[] = [
  {
    id: "ann-1",
    text: "we always double-check each other's coding",
    reason: "Explicit account of mutual verification",
    color: "blue",
    code: undefined,
  },
  {
    id: "ann-2",
    text: "I stopped sharing drafts after that meeting",
    reason: "Withdrawal from collaboration",
    color: "red",
    code: undefined,
    vote: { find: { found: 1, missed: 0 }, review: "Is this really withdrawal?" },
  },
]

const readOnlyEntries = annotations.map(annotationToEntry({}, {}))

const editableEntry = (overrides: Partial<HighlightEntry> = {}): HighlightEntry => ({
  id: "entry-1",
  color: "var(--blue-7)",
  title: "Trust",
  description: "Explicit account of mutual verification",
  review: "Needs a second look",
  onLock: fn(),
  onCopy: fn(),
  onDelete: fn(),
  onResolve: fn(),
  onDescriptionChange: fn(),
  onReviewChange: fn(),
  ...overrides,
})

const meta: Meta<typeof HighlightTooltip> = {
  title: "Custom/Editor/HighlightTooltip",
  component: HighlightTooltip,
}

export default meta
type Story = StoryObj<typeof HighlightTooltip>

export const ReadOnlyFromAnnotations: Story = {
  args: { entries: readOnlyEntries },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryAllByRole("textbox")).toHaveLength(0)
    expect(canvas.getByText("Explicit account of mutual verification")).toBeInTheDocument()
    expect(canvas.getByText("Is this really withdrawal?")).toBeInTheDocument()
    const copyOnlyButtons = canvas.getAllByRole("button")
    expect(copyOnlyButtons).toHaveLength(annotations.length)
  },
}

export const Editable: Story = {
  args: { entries: [editableEntry()] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const entry = args.entries[0]

    const textareas = canvas.getAllByRole("textbox")
    expect(textareas).toHaveLength(2)

    const [lock, copy, del, resolve] = canvas.getAllByRole("button")
    expect(resolve).toBeDefined()
    expect(copy).toBeDefined()

    await userEvent.click(del)
    expect(entry.onDelete).toHaveBeenCalledOnce()

    await userEvent.click(lock)
    expect(entry.onLock).toHaveBeenCalledOnce()
  },
}

export const Locked: Story = {
  args: { entries: [editableEntry({ isLocked: true })] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    for (const textarea of canvas.getAllByRole("textbox")) {
      expect(textarea).toBeDisabled()
    }

    expect(canvas.getAllByRole("button")).toHaveLength(2)

    const disabledDelete = canvasElement.querySelector(".cursor-not-allowed")
    expect(disabledDelete).not.toBeNull()
    if (disabledDelete) await userEvent.hover(disabledDelete)
    await waitFor(() => {
      expect(within(document.body).getAllByText("Unlock to edit").length).toBeGreaterThan(0)
    })
  },
}

export const MultiEntry: Story = {
  args: {
    entries: [
      editableEntry({ id: "entry-a", title: "Entry A", color: "var(--blue-7)" }),
      editableEntry({ id: "entry-b", title: "Entry B", color: "var(--red-7)" }),
      editableEntry({ id: "entry-c", title: "Entry C", color: "var(--green-7)" }),
    ],
    onEntryHover: fn(),
    onEntryLeave: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)

    const header = canvasElement.querySelector<HTMLElement>("[data-tooltip-root] > div")
    expect(header?.style.background).toContain("linear-gradient")

    await userEvent.hover(canvas.getByText("Entry B"))
    expect(args.onEntryHover).toHaveBeenCalledWith("entry-b")

    await userEvent.unhover(canvas.getByText("Entry B"))
    await waitFor(() => expect(args.onEntryLeave).toHaveBeenCalled())
  },
}
