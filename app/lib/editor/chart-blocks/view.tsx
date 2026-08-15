"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useNavigate, useParams } from "react-router"
import { FileText, MapPin } from "lucide-react"
import { executeQuery } from "~/lib/db/query"
import { extractEntityIdsFromRows } from "~/lib/chart/entities"
import { resolveChartData } from "~/lib/chart/resolve"
import { CHART_COLOR_SHADE, type ColorContext } from "~/lib/chart/color"
import type { ChartEntityMap } from "~/lib/chart/types"
import { getDatabase, getSyncRevision, subscribeSyncRevision } from "~/domain/db/database"
import { getEntityPrefixes } from "~/lib/data-blocks/registry"
import { formatCaption } from "~/lib/data-blocks/caption"
import { resolveRadixHex } from "~/ui/theme/radix"
import { resolveEntityLink, type EntityIcons } from "~/lib/markdown/resolve"
import { useIsReadOnly } from "~/ui/components/editor/ReadOnlyContext"
import { useDebugOptions } from "~/ui/components/editor/DebugOptionsContext"
import { useFiles } from "~/ui/hooks/useFiles"
import type { ChartBlock } from "~/domain/data-blocks/chart/schema"
import { ChartCard, type ChartCardState } from "./ChartCard"
import type { ChartTooltipContext } from "./renderers/ChartTooltip"
import { FALLBACK_COLOR } from "./renderers/shared"

interface ChartBlockViewProps {
  data: ChartBlock
  onDelete: () => void
  captionType?: string
  captionIndex: number
}

type QueryState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: Record<string, unknown>[] }

const ENTITY_ICONS: EntityIcons = { file: FileText, spotlight: MapPin }

const EMPTY_ENTITY_MAP: ChartEntityMap = {}

const buildChartEntityMap = (
  rows: Record<string, unknown>[],
  files: Record<string, string>,
  projectId: string | undefined
): ChartEntityMap => {
  if (!projectId) return EMPTY_ENTITY_MAP
  const ids = extractEntityIdsFromRows(rows, getEntityPrefixes())
  if (ids.length === 0) return EMPTY_ENTITY_MAP

  const map: ChartEntityMap = {}
  for (const id of ids) {
    const resolved = resolveEntityLink(`file://${id}`, files, projectId, ENTITY_ICONS)
    if (!resolved) continue
    map[id] = {
      id,
      label: resolved.label,
      url: resolved.url,
      color: resolved.color ?? "",
    }
  }
  return map
}

export const ChartBlockView = ({
  data,
  onDelete,
  captionType,
  captionIndex,
}: ChartBlockViewProps) => {
  const isReadOnly = useIsReadOnly()
  const { files } = useFiles()
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const debugOptions = useDebugOptions()
  const showQueryResults = !!debugOptions.showQueryResults
  const [queryState, setQueryState] = useState<QueryState>({ status: "loading" })

  const syncRevision = useSyncExternalStore(subscribeSyncRevision, getSyncRevision)

  useEffect(() => {
    let aborted = false

    const fetchData = async () => {
      const db = getDatabase()
      if (!db) return

      const result = await executeQuery<Record<string, unknown>>(db.instance, data.query)
      if (aborted) return

      if (!result.ok) {
        setQueryState({ status: "error", message: result.error.message })
        return
      }

      if (result.value.rows.length === 0) {
        setQueryState({ status: "empty" })
        return
      }

      setQueryState({ status: "ready", rows: result.value.rows })
    }

    fetchData()
    return () => {
      aborted = true
    }
  }, [data.query, syncRevision])

  const handleDatumClick = useCallback((url: string) => navigate(url), [navigate])

  const cardState = useMemo<ChartCardState>(() => {
    if (queryState.status !== "ready") return queryState
    const entityMap = buildChartEntityMap(queryState.rows, files, projectId)
    const colorContext: ColorContext = {
      entityMap,
      resolveRadix: resolveRadixHex,
      shade: CHART_COLOR_SHADE,
      fallback: FALLBACK_COLOR,
    }
    const renderable = resolveChartData({
      spec: data.spec,
      rows: queryState.rows,
      entityMap,
      colorContext,
    })
    const tooltipContext: ChartTooltipContext = {
      files,
      projectId: projectId ?? null,
      entityMap,
      navigate,
    }
    return {
      status: "ready",
      renderable,
      tooltipContext,
      queryResults: showQueryResults ? { rows: queryState.rows, query: data.query } : undefined,
    }
  }, [queryState, data.spec, data.query, files, projectId, navigate, showQueryResults])

  return (
    <ChartCard
      state={cardState}
      caption={
        data.caption.label
          ? formatCaption(captionType, captionIndex, data.caption.label)
          : undefined
      }
      onDelete={isReadOnly ? undefined : onDelete}
      onDatumClick={handleDatumClick}
    />
  )
}
