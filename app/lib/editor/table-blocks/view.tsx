"use client"

import { useMemo, useState } from "react"
import { cellAt, parseCell } from "~/lib/cells/parse"
import type { CellType } from "~/lib/cells/types"
import type { TableBlock } from "~/domain/data-blocks/table/schema"
import { formatCaption } from "~/lib/data-blocks/caption"
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  renameColumn,
  setCell,
  setColumnType,
} from "~/domain/data-blocks/table/transforms"
import { useIsReadOnly } from "~/ui/components/editor/ReadOnlyContext"
import { claimConverted } from "./conversion-meta"
import { TableCard, cellId } from "./TableCard"

export interface TableBlockViewProps {
  data: TableBlock
  onUpdate: (next: TableBlock) => void
  onDelete: () => void
  captionType?: string
  captionIndex: number
}

const findInvalidCells = (table: TableBlock): ReadonlySet<string> => {
  const invalid = new Set<string>()
  table.rows.forEach((row, rowIndex) => {
    for (const column of table.columns) {
      if (parseCell(cellAt(row, column.key), column.type).kind === "invalid") {
        invalid.add(cellId(rowIndex, column.key))
      }
    }
  })
  return invalid
}

const useConversionClaim = (id: string): boolean => {
  const [claimed] = useState(() => claimConverted(id))
  return claimed
}

export const TableBlockView = ({
  data,
  onUpdate,
  onDelete,
  captionType,
  captionIndex,
}: TableBlockViewProps) => {
  const readOnly = useIsReadOnly()
  const invalidCells = useMemo(() => findInvalidCells(data), [data])
  const autoFocusFirstCell = useConversionClaim(data.id)

  return (
    <TableCard
      columns={data.columns}
      rows={data.rows}
      invalidCells={invalidCells}
      caption={
        data.caption.label
          ? formatCaption(captionType, captionIndex, data.caption.label)
          : undefined
      }
      readOnly={readOnly}
      autoFocusFirstCell={autoFocusFirstCell}
      onEditCell={(rowIndex, columnKey, value) =>
        onUpdate(setCell(data, rowIndex, columnKey, value))
      }
      onRenameColumn={(columnKey, name) => onUpdate(renameColumn(data, columnKey, name))}
      onSetColumnType={(columnKey, type: CellType) =>
        onUpdate(setColumnType(data, columnKey, type))
      }
      onAddColumn={(index, name) => onUpdate(addColumn(data, index, name))}
      onDeleteColumn={(columnKey) => onUpdate(deleteColumn(data, columnKey))}
      onAddRow={(index) => onUpdate(addRow(data, index))}
      onDeleteRow={(rowIndex) => onUpdate(deleteRow(data, rowIndex))}
      onDelete={readOnly ? undefined : onDelete}
    />
  )
}
