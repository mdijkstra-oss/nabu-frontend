"use client"

import { useState } from "react"
import { useFiles } from "~/ui/hooks/useFiles"
import { getSelectedCodes, toggleSelectedCode } from "~/domain/data-blocks/ux/selectors"
import { writeSelectedCodes } from "~/domain/actions/select-codes/apply"
import { addCodebookEntry } from "~/domain/actions/coding/actions"
import { dispatchTask } from "~/lib/agent/dispatch"
import { NabuGate } from "~/ui/components/nabu/NabuGate"
import { useSelection } from "../useSelection"
import { CodesSidebar, type CodesSidebarProps } from "./CodesSidebar"

type ConnectedCodesSidebarProps = Omit<
  CodesSidebarProps,
  | "selectedCodeIds"
  | "onToggleCode"
  | "searchValue"
  | "onSearchChange"
  | "onNewCode"
  | "gateNewCode"
>

export const ConnectedCodesSidebar = (props: ConnectedCodesSidebarProps) => {
  const [searchValue, setSearchValue] = useState("")
  const { files } = useFiles()
  const { selected: selectedCodes, toggleSelection: toggleCode } = useSelection(
    files,
    getSelectedCodes,
    toggleSelectedCode,
    writeSelectedCodes
  )

  return (
    <CodesSidebar
      {...props}
      selectedCodeIds={selectedCodes}
      onToggleCode={toggleCode}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      onNewCode={() => dispatchTask(addCodebookEntry())}
      gateNewCode={(button) => (
        <NabuGate tooltip="Ask Nabu to add a codebook entry">{button}</NabuGate>
      )}
    />
  )
}
