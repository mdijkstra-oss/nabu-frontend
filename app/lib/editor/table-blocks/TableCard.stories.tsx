import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { dirtyTableFixture, tableFixture } from "~/domain/data-blocks/table/test-helpers"
import { mustFind } from "../../../../.storybook/dom"
import { withSize } from "../../../../.storybook/decorators"
import { TableCard, cellId, type TableCardProps } from "./TableCard"

const meta: Meta<typeof TableCard> = {
  title: "Custom/Tables/TableCard",
  component: TableCard,
  decorators: [withSize({ width: "680px" })],
}

export default meta
type Story = StoryObj<typeof TableCard>

const fixture = tableFixture()

const editableArgs = (overrides: Partial<TableCardProps> = {}): TableCardProps => ({
  columns: fixture.columns,
  rows: fixture.rows,
  invalidCells: new Set<string>(),
  readOnly: false,
  onEditCell: fn(),
  onRenameColumn: fn(),
  onSetColumnType: fn(),
  onAddColumn: fn(),
  onDeleteColumn: fn(),
  onAddRow: fn(),
  onDeleteRow: fn(),
  ...overrides,
})

const headerNames = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll("[data-column-header]")].map((el) => el.textContent ?? "")

const cellElement = (
  canvasElement: HTMLElement,
  rowIndex: number,
  columnKey: string
): HTMLElement => mustFind(canvasElement, `[data-cell="${cellId(rowIndex, columnKey)}"]`)

const isMarkedInvalid = (cell: HTMLElement): boolean =>
  cell.dataset.invalid === "true" &&
  cell.className.includes("ring-error-600") &&
  cell.className.includes("bg-error-50")

const typeChoices = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll("[data-type-choices] [aria-checked]")].map(
    (el) => el.textContent ?? ""
  )

const markedTypeChoices = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('[data-type-choices] [aria-checked="true"]')].map(
    (el) => el.textContent ?? ""
  )

export const Ready: Story = {
  args: editableArgs(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(headerNames(canvasElement)).toEqual(["Month", "Amount", "Note"])
    expect(canvas.getByLabelText("Month, row 1")).toHaveValue("2026-01-05")
    expect(canvas.getByLabelText("Amount, row 1")).toHaveValue("42")
    expect(canvas.getByLabelText("Note, row 1")).toHaveValue("cleaning")
    expect(canvas.getByLabelText("Month, row 2")).toHaveValue("2026-02-05")
    expect(canvas.getByLabelText("Amount, row 2")).toHaveValue("17.5")
    expect(canvas.getByLabelText("Note, row 2")).toHaveValue("")
    expect(document.activeElement).not.toBe(canvas.getByLabelText("Month, row 1"))
  },
}

export const InvalidCells: Story = {
  args: editableArgs({
    rows: dirtyTableFixture().rows,
    invalidCells: new Set([cellId(0, "amount")]),
  }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(isMarkedInvalid(cellElement(canvasElement, 0, "amount"))).toBe(true)
    expect(isMarkedInvalid(cellElement(canvasElement, 0, "month"))).toBe(false)
    expect(isMarkedInvalid(cellElement(canvasElement, 0, "note"))).toBe(false)
    expect(isMarkedInvalid(cellElement(canvasElement, 1, "amount"))).toBe(false)

    const input = canvas.getByLabelText("Amount, row 1")
    await userEvent.click(input)
    expect(document.activeElement).toBe(input)
    await userEvent.type(input, "!")
    expect(input).toHaveValue("about forty!")
    expect(isMarkedInvalid(cellElement(canvasElement, 0, "amount"))).toBe(true)
    expect(args.onEditCell).not.toHaveBeenCalled()
  },
}

// grid.md: "While a cell is focused and mid-edit the marking reflects the last
// committed value, not the draft." Typing an unparsable draft into a
// currently-valid number cell, before committing, must not turn the cell red.
export const MidEditDraftDoesNotMarkInvalidEarly: Story = {
  args: editableArgs(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(isMarkedInvalid(cellElement(canvasElement, 0, "amount"))).toBe(false)

    const input = canvas.getByLabelText("Amount, row 1")
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "not a number")

    expect(input).toHaveValue("not a number")
    expect(isMarkedInvalid(cellElement(canvasElement, 0, "amount"))).toBe(false)
  },
}

export const ZeroRows: Story = {
  args: editableArgs({ rows: [] }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(headerNames(canvasElement)).toEqual(["Month", "Amount", "Note"])
    expect(canvas.queryAllByRole("textbox")).toHaveLength(0)
    expect(canvas.queryByText("No columns")).toBeNull()

    await userEvent.click(canvas.getByRole("button", { name: "Insert row at position 1" }))
    expect(args.onAddRow).toHaveBeenCalledOnce()
    expect(args.onAddRow).toHaveBeenCalledWith(0)
  },
}

export const ZeroColumns: Story = {
  args: editableArgs({
    columns: [],
    rows: [],
    caption: "Table 2: Nothing yet",
    onDelete: fn(),
  }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText("No columns")).toBeInTheDocument()
    expect(canvas.getByText("Table 2: Nothing yet")).toBeInTheDocument()
    expect(canvas.getByLabelText("Delete table")).toBeInTheDocument()
    expect(canvasElement.querySelector("code")).toBeNull()

    await userEvent.click(canvas.getByRole("button", { name: "Add column" }))
    expect(canvas.getByLabelText("Column name")).toHaveValue("Column 1")
    expect(args.onAddColumn).not.toHaveBeenCalled()
  },
}

// Opening the draft column at index 0 on a zero-column table switches the
// body out of the "No columns" placeholder into a table row with just the
// draft header — a transition the ZeroColumns story doesn't exercise past the
// initial click. Confirms it renders (no crash) and the placeholder is gone.
export const ZeroColumnsDraftReplacesPlaceholder: Story = {
  args: editableArgs({ columns: [], rows: [] }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Add column" }))

    expect(canvas.queryByText("No columns")).toBeNull()
    const field = canvas.getByLabelText("Column name")
    expect(field).toHaveValue("Column 1")

    await userEvent.clear(field)
    await userEvent.type(field, "First{Enter}")
    expect(args.onAddColumn).toHaveBeenCalledOnce()
    expect(args.onAddColumn).toHaveBeenCalledWith(0, "First")
  },
}

export const ReadOnly: Story = {
  args: editableArgs({
    rows: dirtyTableFixture().rows,
    invalidCells: new Set([cellId(0, "amount")]),
    caption: "Table 1: Monthly expenses",
    readOnly: true,
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(headerNames(canvasElement)).toEqual(["Month", "Amount", "Note"])
    expect(canvas.getByText("about forty")).toBeInTheDocument()
    expect(canvas.getByText("Table 1: Monthly expenses")).toBeInTheDocument()
    expect(canvas.queryAllByRole("textbox")).toHaveLength(0)
    expect(canvas.queryAllByRole("button")).toHaveLength(0)
    expect(isMarkedInvalid(cellElement(canvasElement, 0, "amount"))).toBe(true)
    expect(isMarkedInvalid(cellElement(canvasElement, 0, "month"))).toBe(false)
  },
}

export const ReadOnlyZeroColumns: Story = {
  args: editableArgs({ columns: [], rows: [], readOnly: true }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText("No columns")).toBeInTheDocument()
    expect(canvas.queryAllByRole("button")).toHaveLength(0)
  },
}

export const HeaderPopover: Story = {
  args: editableArgs(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Month" }))

    expect(canvas.getByLabelText("Column name")).toHaveValue("Month")
    expect(typeChoices(canvasElement)).toEqual(["Text", "Number", "Date"])
    expect(markedTypeChoices(canvasElement)).toEqual(["Date"])
    expect(canvas.getByRole("button", { name: "Delete column" })).toBeInTheDocument()
  },
}

export const RenameColumn: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Amount" }))

    const field = canvas.getByLabelText("Column name")
    await userEvent.clear(field)
    await userEvent.type(field, "Cost{Enter}")

    expect(args.onRenameColumn).toHaveBeenCalledOnce()
    expect(args.onRenameColumn).toHaveBeenCalledWith("amount", "Cost")
    expect(args.onSetColumnType).not.toHaveBeenCalled()
    expect(args.onDeleteColumn).not.toHaveBeenCalled()
    expect(args.onEditCell).not.toHaveBeenCalled()
    expect(canvas.queryByLabelText("Column name")).toBeNull()
  },
}

// table-block.md: a rename is a write; committing the popover with the name
// unchanged is not an edit and must fire no write.
export const RenameColumnUnchangedWritesNothing: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Amount" }))

    const field = canvas.getByLabelText("Column name")
    await userEvent.click(field)
    await userEvent.keyboard("{Enter}")

    expect(args.onRenameColumn).not.toHaveBeenCalled()
    expect(canvas.queryByLabelText("Column name")).toBeNull()
  },
}

export const SetColumnType: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Note" }))
    expect(markedTypeChoices(canvasElement)).toEqual(["Text"])
    await userEvent.click(canvas.getByText("Date"))

    expect(args.onSetColumnType).toHaveBeenCalledOnce()
    expect(args.onSetColumnType).toHaveBeenCalledWith("note", "date")
    expect(args.onEditCell).not.toHaveBeenCalled()
    expect(args.onRenameColumn).not.toHaveBeenCalled()
    expect(canvas.getByLabelText("Note, row 1")).toHaveValue("cleaning")
    expect(canvas.getByLabelText("Month, row 1")).toHaveValue("2026-01-05")
  },
}

export const DeleteColumn: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Amount" }))
    await userEvent.click(canvas.getByRole("button", { name: "Delete column" }))

    expect(args.onDeleteColumn).toHaveBeenCalledOnce()
    expect(args.onDeleteColumn).toHaveBeenCalledWith("amount")
    expect(args.onRenameColumn).not.toHaveBeenCalled()
    expect(canvas.queryByLabelText("Column name")).toBeNull()
  },
}

export const CellCommit: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText("Note, row 1")

    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "washing")
    expect(args.onEditCell).not.toHaveBeenCalled()

    await userEvent.tab()
    expect(args.onEditCell).toHaveBeenCalledOnce()
    expect(args.onEditCell).toHaveBeenCalledWith(0, "note", "washing")
  },
}

export const CellCommitOnEnter: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText("Amount, row 2")

    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "99{Enter}")

    expect(args.onEditCell).toHaveBeenCalledOnce()
    expect(args.onEditCell).toHaveBeenCalledWith(1, "amount", "99")
  },
}

// grid.md: "The grid performs exactly one doc write per committed edit." Enter
// commits; if a later blur (e.g. Tab away) fires a second onEditCell, that's
// two writes for one edit.
export const CellCommitOnEnterThenBlurNoDoubleWrite: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText("Amount, row 2")

    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "99{Enter}")
    await userEvent.tab()

    expect(args.onEditCell).toHaveBeenCalledOnce()
    expect(args.onEditCell).toHaveBeenCalledWith(1, "amount", "99")
  },
}

export const CellCommitUnchangedWritesNothing: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText("Note, row 2"))
    await userEvent.tab()
    expect(args.onEditCell).not.toHaveBeenCalled()
  },
}

export const CellEscape: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText("Note, row 1")

    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "scrapped{Escape}")

    expect(input).toHaveValue("cleaning")
    expect(args.onEditCell).not.toHaveBeenCalled()

    await userEvent.tab()
    expect(args.onEditCell).not.toHaveBeenCalled()
  },
}

// grid.md: "Escape reverts the draft ... without a write." The spec doesn't say
// focus leaves the cell, so it should stay — and a second Escape on an
// already-reverted draft should be a harmless no-op, not a second write.
export const EscapeKeepsFocusInCellAndIsIdempotent: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText("Note, row 1")

    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "scrapped{Escape}")

    expect(input).toHaveValue("cleaning")
    expect(document.activeElement).toBe(input)

    await userEvent.keyboard("{Escape}")
    expect(input).toHaveValue("cleaning")
    expect(document.activeElement).toBe(input)
    expect(args.onEditCell).not.toHaveBeenCalled()
  },
}

export const TabMoves: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText("Month, row 1")

    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "2026-03-01")
    await userEvent.tab()

    expect(args.onEditCell).toHaveBeenCalledOnce()
    expect(args.onEditCell).toHaveBeenCalledWith(0, "month", "2026-03-01")
    expect(document.activeElement).toBe(canvas.getByLabelText("Amount, row 1"))

    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(canvas.getByLabelText("Month, row 1"))
    expect(args.onEditCell).toHaveBeenCalledOnce()
  },
}

export const AddColumnCommit: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Insert column at position 2" }))

    expect(headerNames(canvasElement)).toEqual(["Month", "Column 4", "Amount", "Note"])
    const field = canvas.getByLabelText("Column name")
    expect(field).toHaveValue("Column 4")
    expect(args.onAddColumn).not.toHaveBeenCalled()

    await userEvent.clear(field)
    await userEvent.type(field, "Score{Enter}")

    expect(args.onAddColumn).toHaveBeenCalledOnce()
    expect(args.onAddColumn).toHaveBeenCalledWith(1, "Score")
    expect(args.onEditCell).not.toHaveBeenCalled()
    expect(args.onRenameColumn).not.toHaveBeenCalled()
    expect(headerNames(canvasElement)).toEqual(["Month", "Amount", "Note"])
  },
}

export const AddColumnEscape: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Insert column at position 2" }))

    const field = canvas.getByLabelText("Column name")
    await userEvent.clear(field)
    await userEvent.type(field, "Score{Escape}")

    expect(args.onAddColumn).not.toHaveBeenCalled()
    expect(headerNames(canvasElement)).toEqual(["Month", "Amount", "Note"])
    expect(canvas.queryByLabelText("Column name")).toBeNull()
  },
}

// grid.md: "clicking away commits, exactly as leaving a cell does" is the
// stated cancel-vs-commit rule for the draft column's popover. Clicking a
// different column's header while the draft is open is clicking away from the
// draft's popover; per that rule it should commit the draft (one onAddColumn),
// not silently drop it.
export const DraftColumnCommitsWhenAnotherHeaderIsClicked: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Insert column at position 2" }))

    const field = canvas.getByLabelText("Column name")
    await userEvent.clear(field)
    await userEvent.type(field, "Score")
    expect(args.onAddColumn).not.toHaveBeenCalled()

    await userEvent.click(canvas.getByRole("button", { name: "Note" }))

    expect(args.onAddColumn).toHaveBeenCalledOnce()
    expect(args.onAddColumn).toHaveBeenCalledWith(1, "Score")
  },
}

export const AddRow: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Insert row at position 2" }))

    expect(args.onAddRow).toHaveBeenCalledOnce()
    expect(args.onAddRow).toHaveBeenCalledWith(1)
  },
}

export const DeleteRow: Story = {
  args: editableArgs(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Delete row 2" }))

    expect(args.onDeleteRow).toHaveBeenCalledOnce()
    expect(args.onDeleteRow).toHaveBeenCalledWith(1)
  },
}

export const AutoFocusFirstCell: Story = {
  args: editableArgs({ autoFocusFirstCell: true }),
  play: async ({ canvasElement }) => {
    expect(document.activeElement).toBe(within(canvasElement).getByLabelText("Month, row 1"))
  },
}

export const WithCaption: Story = {
  args: editableArgs({ caption: "Table 3: Monthly expenses" }),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByText("Table 3: Monthly expenses")).toBeInTheDocument()
  },
}

export const WithoutCaption: Story = {
  args: editableArgs(),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByText(/^Table /)).toBeNull()
  },
}

export const WithDelete: Story = {
  args: editableArgs({ onDelete: fn() }),
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByLabelText("Delete table"))
    expect(args.onDelete).toHaveBeenCalledOnce()
  },
}

export const WithoutDelete: Story = {
  args: editableArgs(),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByLabelText("Delete table")).toBeNull()
  },
}
