"use client"

import { useState, useEffect, useSyncExternalStore } from "react"
import { ChevronRight, ChevronDown, Copy, Check, ListX, ListChecks } from "lucide-react"
import { AutoScroll } from "~/ui/components/AutoScroll"
import { getRawCalls, subscribeRawCalls, type RawLlmCall } from "~/lib/agent/client/raw-store"
import { matchesWordsInOrder } from "~/lib/utils/filter"

const isPending = (call: RawLlmCall): boolean => call.duration === null
const isCanceled = (call: RawLlmCall): boolean => call.duration === -1

const formatDuration = (ms: number | null): string => {
  if (ms === null) return "pending…"
  if (ms === -1) return "canceled"
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

const prettyJson = (json: string): string => {
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    return json
  }
}

const PREVIEW_LENGTH = 80

const endpointLabel = (endpoint: string): string => endpoint

const toggleId = (set: Set<number>, id: number): Set<number> => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

const addAllIds = (set: Set<number>, ids: number[]): Set<number> => {
  const next = new Set(set)
  for (const id of ids) next.add(id)
  return next
}

const formatCallEntry = (call: RawLlmCall): string =>
  `[${endpointLabel(call.endpoint)}] ${formatDuration(call.duration)}\n\n${call.rawResponse ?? (call.streamingContent || "(pending)")}`

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={handleCopy} className="p-1 text-neutral-400 hover:text-neutral-600">
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

interface SectionProps {
  label: string
  displayContent: string
  copyContent: string
  borderColor: string
  labelColor: string
  defaultExpanded?: boolean
}

const Section = ({
  label,
  displayContent,
  copyContent,
  borderColor,
  labelColor,
  defaultExpanded = false,
}: SectionProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={`border-l-2 ${borderColor} pl-2`}>
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1 text-xs ${labelColor} font-medium hover:opacity-80`}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {label}
        </button>
        <CopyButton text={copyContent} />
      </div>
      {expanded && (
        <pre className="mt-1 max-h-[400px] overflow-auto rounded bg-neutral-50 p-2 text-xs font-mono text-neutral-700 whitespace-pre-wrap">
          {displayContent}
        </pre>
      )}
      {!expanded && (
        <span className="text-xs text-neutral-400 pl-4">
          {displayContent.slice(0, PREVIEW_LENGTH).replace(/\n/g, " ")}
          {displayContent.length > PREVIEW_LENGTH ? "..." : ""}
        </span>
      )}
    </div>
  )
}

interface RawCallEntryProps {
  call: RawLlmCall
  selected: boolean
  onToggleSelect: () => void
}

const PendingDot = () => (
  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
)

const CanceledDot = () => <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400" />

const RawCallEntry = ({ call, selected, onToggleSelect }: RawCallEntryProps) => {
  const pending = isPending(call)
  const canceled = isCanceled(call)
  const [expanded, setExpanded] = useState(false)
  const time = new Date(call.timestamp).toLocaleTimeString()

  const handleCheckbox = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleSelect()
  }

  return (
    <div
      className={`rounded border ${canceled ? "border-red-200 bg-red-50/30" : pending ? "border-amber-200 bg-amber-50/30" : selected ? "border-neutral-400 bg-neutral-50" : "border-neutral-200"}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-neutral-50"
      >
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onClick={handleCheckbox}
            readOnly
            className="w-3 h-3 accent-neutral-500 cursor-pointer"
          />
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-neutral-400" />
          ) : (
            <ChevronRight className="w-3 h-3 text-neutral-400" />
          )}
          {canceled && <CanceledDot />}
          {pending && <PendingDot />}
          <span className="text-xs font-mono font-medium text-neutral-700">
            {endpointLabel(call.endpoint)}
          </span>
        </div>
        <span className="text-xs text-neutral-400">
          {formatDuration(call.duration)} · {time}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-neutral-100 px-3 py-2">
          <Section
            label="Input"
            displayContent={prettyJson(call.requestBody)}
            copyContent={call.requestBody}
            borderColor="border-blue-300"
            labelColor="text-blue-600"
          />
          {call.rawResponse !== null ? (
            <Section
              label="Output"
              displayContent={prettyJson(call.rawResponse)}
              copyContent={call.rawResponse}
              borderColor="border-green-300"
              labelColor="text-green-600"
            />
          ) : call.streamingContent ? (
            <Section
              label="Output (streaming)"
              displayContent={call.streamingContent}
              copyContent={call.streamingContent}
              borderColor="border-amber-300"
              labelColor="text-amber-600"
              defaultExpanded
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

const FILTER_MIN_LENGTH = 5
const FILTER_DEBOUNCE_MS = 300

const callMatchesFilter = (call: RawLlmCall, filter: string): boolean =>
  matchesWordsInOrder(filter, [
    call.endpoint,
    call.requestBody,
    call.rawResponse ?? "",
    call.streamingContent,
  ])

const filterCalls = (calls: RawLlmCall[], filter: string): RawLlmCall[] =>
  filter.length < FILTER_MIN_LENGTH ? calls : calls.filter((c) => callMatchesFilter(c, filter))

const useDebouncedValue = (value: string, delay: number): string => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const useRawCalls = () => useSyncExternalStore(subscribeRawCalls, getRawCalls, getRawCalls)

export const DebugRawTab = () => {
  const calls = useRawCalls()
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [copiedAll, setCopiedAll] = useState(false)
  const [filterText, setFilterText] = useState("")
  const debouncedFilter = useDebouncedValue(filterText, FILTER_DEBOUNCE_MS)
  const filteredCalls = filterCalls(calls, debouncedFilter)
  const isFiltering = debouncedFilter.length >= FILTER_MIN_LENGTH

  const hasSelection = selectedIds.size > 0

  const handleToggle = (id: number) => setSelectedIds((prev) => toggleId(prev, id))

  const handleDeselectAll = () => setSelectedIds(new Set())

  const handleSelectFiltered = () =>
    setSelectedIds((prev) =>
      addAllIds(
        prev,
        filteredCalls.map((c) => c.id)
      )
    )

  const handleCopySelected = () => {
    const toCopy = hasSelection ? calls.filter((c) => selectedIds.has(c.id)) : calls
    const content = toCopy.map(formatCallEntry).join("\n\n===\n\n")
    navigator.clipboard.writeText(content)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }

  if (calls.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-neutral-400">No LLM calls yet</span>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-neutral-100 px-3 py-1.5">
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder={`Filter raw calls (min ${FILTER_MIN_LENGTH} chars)…`}
          className="w-full rounded border border-neutral-200 bg-white px-2 py-1 text-xs font-mono text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
        />
        {isFiltering && (
          <span className="mt-1 block text-xs text-neutral-400">
            {filteredCalls.length} / {calls.length}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-1.5">
        <span className="text-xs text-neutral-500">{selectedIds.size} selected</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleSelectFiltered}
            className="p-1 text-neutral-400 hover:text-neutral-600"
            title={`Select ${filteredCalls.length} visible`}
          >
            <ListChecks className="w-3.5 h-3.5" />
          </button>
          {hasSelection && (
            <button
              onClick={handleDeselectAll}
              className="p-1 text-neutral-400 hover:text-neutral-600"
              title="Deselect all"
            >
              <ListX className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleCopySelected}
            className="p-1 text-neutral-500 hover:text-neutral-700"
            title={hasSelection ? `Copy ${selectedIds.size} selected` : "Copy all"}
          >
            {copiedAll ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
      <AutoScroll className="flex-1 overflow-y-auto flex flex-col gap-2 px-3 py-3">
        {filteredCalls.map((call) => (
          <RawCallEntry
            key={call.id}
            call={call}
            selected={selectedIds.has(call.id)}
            onToggleSelect={() => handleToggle(call.id)}
          />
        ))}
      </AutoScroll>
    </div>
  )
}
