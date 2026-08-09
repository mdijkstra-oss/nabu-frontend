"use client"

import { useState } from "react"
import { useFiles } from "~/ui/hooks/useFiles"
import { getSelectedCodes, toggleSelectedCode } from "~/domain/data-blocks/ux/selectors"
import { writeSelectedCodes } from "~/domain/actions/select-codes/apply"
import { useSelection } from "../useSelection"
import { CodesSidebar, type CodesSidebarProps } from "./CodesSidebar"

type ConnectedCodesSidebarProps = Omit<
  CodesSidebarProps,
  "selectedCodeIds" | "onToggleCode" | "searchValue" | "onSearchChange"
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
    />
  )
}
