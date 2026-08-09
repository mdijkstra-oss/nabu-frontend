"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { getFiles, subscribe } from "~/lib/files/store"
import { getSelectedCodes, toggleSelectedCode } from "~/domain/data-blocks/ux/selectors"
import { writeSelectedCodes } from "~/domain/actions/select-codes/apply"
import { CodesSidebar, type CodesSidebarProps } from "./CodesSidebar"

type ConnectedCodesSidebarProps = Omit<
  CodesSidebarProps,
  "selectedCodeIds" | "onToggleCode" | "searchValue" | "onSearchChange"
>

export const ConnectedCodesSidebar = (props: ConnectedCodesSidebarProps) => {
  const [searchValue, setSearchValue] = useState("")
  const files = useSyncExternalStore(subscribe, getFiles)
  const selectedCodes = useMemo(() => getSelectedCodes(files), [files])

  const toggleCode = (id: string) => writeSelectedCodes(toggleSelectedCode([...selectedCodes], id))

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
