"use client"

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { Plus, Trash2 } from "lucide-react"
import { cellAt } from "~/lib/cells/parse"
import type { CellType } from "~/lib/cells/types"
import type { TableColumn, TableRow } from "~/domain/data-blocks/table/schema"
import { IconButton } from "~/ui/components/IconButton"
import { ToggleGroup } from "~/ui/components/ToggleGroup"
import { cn } from "~/ui/utils"

export interface TableCardProps {
  columns: readonly TableColumn[]
  rows: readonly TableRow[]
  invalidCells: ReadonlySet<string>
  caption?: string
  readOnly: boolean
  autoFocusFirstCell?: boolean
  onEditCell: (rowIndex: number, columnKey: string, value: string) => void
  onRenameColumn: (columnKey: string, name: string) => void
  onSetColumnType: (columnKey: string, type: CellType) => void
  onAddColumn: (index: number, name: string) => void
  onDeleteColumn: (columnKey: string) => void
  onAddRow: (index: number) => void
  onDeleteRow: (rowIndex: number) => void
  onDelete?: () => void
}

export const cellId = (rowIndex: number, columnKey: string): string => `${rowIndex}:${columnKey}`

const TYPE_CHOICES: readonly { type: CellType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
]

const INVALID_CELL_CLASS = "bg-error-50 text-error-700 ring-1 ring-inset ring-error-600"

interface CellEdit {
  rowIndex: number
  columnKey: string
  draft: string
}

type PopoverTarget = { kind: "column"; key: string } | { kind: "draft"; index: number }

interface PopoverState {
  target: PopoverTarget
  name: string
}

type HeaderEntry = { kind: "column"; column: TableColumn; index: number } | { kind: "draft" }

const withDraftColumn = (
  columns: readonly TableColumn[],
  draftIndex: number | null
): HeaderEntry[] => {
  const entries: HeaderEntry[] = columns.map((column, index) => ({ kind: "column", column, index }))
  if (draftIndex === null) return entries
  return [...entries.slice(0, draftIndex), { kind: "draft" }, ...entries.slice(draftIndex)]
}

const draftIndexOf = (popover: PopoverState | null): number | null =>
  popover?.target.kind === "draft" ? popover.target.index : null

const ordinal = (index: number): string => String(index + 1)

const leavesPopover = (event: FocusEvent<HTMLElement>): boolean =>
  !event.currentTarget
    .closest("[data-column-popover]")
    ?.contains(event.relatedTarget as Node | null)

interface InsertPointProps {
  label: string
  positionClass: string
  onClick: () => void
}

const InsertPoint = ({ label, positionClass, onClick }: InsertPointProps) => (
  <button
    type="button"
    aria-label={label}
    tabIndex={-1}
    onClick={onClick}
    className={cn(
      "absolute z-20 flex h-4 w-4 items-center justify-center rounded-full border border-solid border-neutral-border bg-default-background text-subtext-color opacity-0 transition-opacity hover:bg-neutral-100 group-hover/spot:opacity-100",
      positionClass
    )}
  >
    <Plus size={10} />
  </button>
)

interface ColumnPopoverProps {
  name: string
  type?: CellType
  onNameChange: (name: string) => void
  onCommit: () => void
  onCancel: () => void
  onSetType?: (type: CellType) => void
  onDeleteColumn?: () => void
}

const ColumnPopover = ({
  name,
  type,
  onNameChange,
  onCommit,
  onCancel,
  onSetType,
  onDeleteColumn,
}: ColumnPopoverProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onCommit()
    }
    if (event.key === "Escape") {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <div
      data-column-popover=""
      className="absolute left-0 top-full z-30 mt-1 flex w-48 flex-col gap-2 rounded-md border border-solid border-neutral-border bg-default-background p-2 text-left shadow-lg"
    >
      <input
        aria-label="Column name"
        autoFocus
        className="h-7 w-full rounded-md border border-solid border-neutral-border bg-default-background px-2 text-body font-body text-default-font outline-none focus:border-brand-primary"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (leavesPopover(event)) onCommit()
        }}
      />
      {onSetType && type && (
        <div data-type-choices="">
          <ToggleGroup
            className="w-full"
            value={type}
            onValueChange={(next) => next && onSetType(next as CellType)}
          >
            {TYPE_CHOICES.map((choice) => (
              <ToggleGroup.Item key={choice.type} value={choice.type} icon={null}>
                {choice.label}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup>
        </div>
      )}
      {onDeleteColumn && (
        <button
          type="button"
          onClick={onDeleteColumn}
          className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-md border-none bg-transparent px-2 text-caption-bold font-caption-bold text-error-700 hover:bg-error-50"
        >
          <Trash2 size={12} />
          Delete column
        </button>
      )}
    </div>
  )
}

const HeaderLabel = ({ columnKey, name }: { columnKey: string; name: string }) => (
  <span
    data-column-header={columnKey}
    className="block px-2 py-1 text-caption-bold font-caption-bold text-subtext-color"
  >
    {name}
  </span>
)

export const TableCard = ({
  columns,
  rows,
  invalidCells,
  caption,
  readOnly,
  autoFocusFirstCell,
  onEditCell,
  onRenameColumn,
  onSetColumnType,
  onAddColumn,
  onDeleteColumn,
  onAddRow,
  onDeleteRow,
  onDelete,
}: TableCardProps) => {
  const [editing, setEditing] = useState<CellEdit | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const firstCellRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocusFirstCell) firstCellRef.current?.focus()
  }, [autoFocusFirstCell])

  const storedValue = (rowIndex: number, columnKey: string): string =>
    (rows[rowIndex] ? cellAt(rows[rowIndex], columnKey) : undefined) ?? ""

  const commitCell = () => {
    if (!editing) return
    setEditing(null)
    if (editing.draft !== storedValue(editing.rowIndex, editing.columnKey)) {
      onEditCell(editing.rowIndex, editing.columnKey, editing.draft)
    }
  }

  const revertCell = () => {
    if (!editing) return
    setEditing({ ...editing, draft: storedValue(editing.rowIndex, editing.columnKey) })
  }

  const commitPopover = () => {
    if (!popover) return
    const { target } = popover
    const name = popover.name.trim()
    setPopover(null)
    if (name === "") return
    if (target.kind === "draft") {
      onAddColumn(target.index, name)
      return
    }
    const column = columns.find((candidate) => candidate.key === target.key)
    if (column && column.name !== name) onRenameColumn(column.key, name)
  }

  const toggleColumnPopover = (column: TableColumn) => {
    if (popover?.target.kind === "column" && popover.target.key === column.key) {
      commitPopover()
      return
    }
    setPopover({ target: { kind: "column", key: column.key }, name: column.name })
  }

  const openDraftColumn = (index: number) =>
    setPopover({ target: { kind: "draft", index }, name: `Column ${ordinal(columns.length)}` })

  const draftIndex = draftIndexOf(popover)
  const headerEntries = withDraftColumn(columns, draftIndex)
  const showInsertPoints = !readOnly && popover === null

  const popoverFor = (column: TableColumn) =>
    popover?.target.kind === "column" && popover.target.key === column.key ? (
      <ColumnPopover
        name={popover.name}
        type={column.type}
        onNameChange={(name) => setPopover({ ...popover, name })}
        onCommit={commitPopover}
        onCancel={() => setPopover(null)}
        onSetType={(type) => {
          if (type !== column.type) onSetColumnType(column.key, type)
        }}
        onDeleteColumn={() => {
          setPopover(null)
          onDeleteColumn(column.key)
        }}
      />
    ) : null

  const renderDraftHeaderCell = (draft: PopoverState) => (
    <th key="draft" className="relative border border-solid border-neutral-border p-0 align-middle">
      <HeaderLabel columnKey="" name={draft.name} />
      <ColumnPopover
        name={draft.name}
        onNameChange={(name) => setPopover({ ...draft, name })}
        onCommit={commitPopover}
        onCancel={() => setPopover(null)}
      />
    </th>
  )

  const renderHeaderCell = (entry: HeaderEntry) => {
    if (entry.kind === "draft") return popover && renderDraftHeaderCell(popover)
    const isLast = entry.index === columns.length - 1
    return (
      <th
        key={entry.column.key}
        className="group/spot relative border border-solid border-neutral-border p-0 align-middle"
      >
        {showInsertPoints && (
          <InsertPoint
            label={`Insert column at position ${ordinal(entry.index)}`}
            positionClass="-left-2 top-1/2 -translate-y-1/2"
            onClick={() => openDraftColumn(entry.index)}
          />
        )}
        {showInsertPoints && isLast && (
          <InsertPoint
            label={`Insert column at position ${ordinal(columns.length)}`}
            positionClass="-right-2 top-1/2 -translate-y-1/2"
            onClick={() => openDraftColumn(columns.length)}
          />
        )}
        {/* With no rows there is no cell to hang the first row's + from. */}
        {showInsertPoints && entry.index === 0 && rows.length === 0 && (
          <InsertPoint
            label="Insert row at position 1"
            positionClass="-left-2 -bottom-2"
            onClick={() => onAddRow(0)}
          />
        )}
        {readOnly ? (
          <HeaderLabel columnKey={entry.column.key} name={entry.column.name} />
        ) : (
          <button
            type="button"
            data-column-header={entry.column.key}
            onClick={() => toggleColumnPopover(entry.column)}
            className="flex h-full w-full cursor-pointer items-center border-none bg-transparent px-2 py-1.5 text-left text-caption-bold font-caption-bold text-subtext-color hover:bg-neutral-100"
          >
            {entry.column.name}
          </button>
        )}
        {popoverFor(entry.column)}
      </th>
    )
  }

  const renderBodyCell = (
    entry: HeaderEntry,
    rowIndex: number,
    isFirstColumn: boolean,
    isLastColumn: boolean,
    isLastRow: boolean
  ) => {
    if (entry.kind === "draft")
      return <td key="draft" className="border border-solid border-neutral-border p-0" />
    const { column } = entry
    const stored = storedValue(rowIndex, column.key)
    const isEditing =
      editing?.rowIndex === rowIndex && editing.columnKey === column.key ? editing : null
    return (
      <td
        key={column.key}
        data-cell={cellId(rowIndex, column.key)}
        data-invalid={invalidCells.has(cellId(rowIndex, column.key)) || undefined}
        className={cn(
          "relative border border-solid border-neutral-border p-0 align-middle",
          invalidCells.has(cellId(rowIndex, column.key)) ? INVALID_CELL_CLASS : ""
        )}
      >
        {isFirstColumn && showInsertPoints && (
          <InsertPoint
            label={`Insert row at position ${ordinal(rowIndex)}`}
            positionClass="-left-2 -top-2"
            onClick={() => onAddRow(rowIndex)}
          />
        )}
        {isFirstColumn && isLastRow && showInsertPoints && (
          <InsertPoint
            label={`Insert row at position ${ordinal(rows.length)}`}
            positionClass="-left-2 -bottom-2"
            onClick={() => onAddRow(rows.length)}
          />
        )}
        {isLastColumn && !readOnly && (
          <IconButton
            aria-label={`Delete row ${ordinal(rowIndex)}`}
            tabIndex={-1}
            variant="neutral-tertiary"
            size="small"
            icon={<Trash2 />}
            className="absolute top-1/2 -right-7 z-20 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100"
            onClick={() => onDeleteRow(rowIndex)}
          />
        )}
        {readOnly ? (
          <span className="block px-2 py-1.5 text-body font-body">{stored}</span>
        ) : (
          <input
            ref={isFirstColumn && rowIndex === 0 ? firstCellRef : undefined}
            aria-label={`${column.name}, row ${ordinal(rowIndex)}`}
            className="h-full w-full border-none bg-transparent px-2 py-1.5 text-body font-body outline-none focus:bg-neutral-50"
            value={isEditing ? isEditing.draft : stored}
            onFocus={() => setEditing({ rowIndex, columnKey: column.key, draft: stored })}
            onChange={(event) =>
              setEditing({ rowIndex, columnKey: column.key, draft: event.target.value })
            }
            onBlur={commitCell}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commitCell()
              }
              if (event.key === "Escape") {
                event.preventDefault()
                revertCell()
              }
            }}
          />
        )}
      </td>
    )
  }

  return (
    <div className="group/table relative my-2 flex w-full flex-col">
      {onDelete && (
        <div className="absolute -top-1 right-0 z-40 opacity-0 transition-opacity group-hover/table:opacity-100">
          <IconButton
            aria-label="Delete table"
            variant="neutral-tertiary"
            size="small"
            icon={<Trash2 />}
            onClick={onDelete}
          />
        </div>
      )}
      <div className="overflow-x-auto py-1 pr-8 pl-3">
        {headerEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6">
            <span className="text-sm text-subtext-color">No columns</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => openDraftColumn(0)}
                className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-solid border-neutral-border bg-default-background px-2 text-caption-bold font-caption-bold text-subtext-color hover:bg-neutral-100"
              >
                <Plus size={12} />
                Add column
              </button>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-body font-body">
            <thead>
              <tr>{headerEntries.map(renderHeaderCell)}</tr>
            </thead>
            <tbody>
              {rows.map((_, rowIndex) => (
                <tr key={rowIndex} className="group/row group/spot">
                  {headerEntries.map((entry, position) =>
                    renderBodyCell(
                      entry,
                      rowIndex,
                      position === 0,
                      position === headerEntries.length - 1,
                      rowIndex === rows.length - 1
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {caption && (
        <div className="px-4 pb-3">
          <span className="text-caption font-caption text-subtext-color italic">{caption}</span>
        </div>
      )}
    </div>
  )
}
