"use client"

import { useState, useEffect } from "react"
import { useSyncExternalStore } from "react"
import { getDatabase } from "~/domain/db/database"
import { getFiles, subscribe } from "~/lib/files/store"
import { getCorpusDescriptions } from "~/domain/corpus/selectors"
import { toCorpusKey } from "~/domain/corpus/types"
import { fetchLanguageStats, type LanguageStatsRow } from "~/lib/search/resolve-semantic"
import {
  collectClassifications,
  groupByCorpus,
  filterExcludedLabels,
  selectSignificantCorpora,
  collectTypeCounts,
  collectSubjectCounts,
} from "~/lib/corpus/tree"
import { groupNearbyLabels, buildRemaps } from "~/lib/corpus/cluster"
import { DEFAULT_CLUSTER_THRESHOLD } from "~/lib/corpus/sync-descriptions"
import { getLlmHost } from "~/lib/agent/env"
import type { CorpusDescription } from "~/domain/corpus/types"
import type { GroupedClassification, FileClassification } from "~/lib/corpus/tree"
import type { LabelRemaps } from "~/lib/corpus/cluster"

interface CorpusStats {
  languages: LanguageStatsRow[]
  descriptions: CorpusDescription[]
  classifications: GroupedClassification[]
  totalFiles: number
}

interface CorporaResult {
  significant: string[]
  loading: boolean
}

const EMPTY_CORPORA_RESULT: CorporaResult = { significant: [], loading: false }

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">{children}</h3>
)

const EmptyRow = ({ label }: { label: string }) => (
  <tr>
    <td colSpan={3} className="py-2 text-xs text-neutral-400 text-center">
      {label}
    </td>
  </tr>
)

const LanguageTable = ({ rows }: { rows: LanguageStatsRow[] }) => (
  <table className="w-full text-xs">
    <thead>
      <tr className="border-b border-neutral-200 text-left text-neutral-500">
        <th className="py-1 pr-4 font-medium">Language</th>
        <th className="py-1 pr-4 font-medium text-right">Count</th>
        <th className="py-1 font-medium text-right">%</th>
      </tr>
    </thead>
    <tbody>
      {rows.length === 0 && <EmptyRow label="No language data" />}
      {rows.map((r) => (
        <tr key={r.language} className="border-b border-neutral-100">
          <td className="py-1 pr-4 font-mono">{r.language}</td>
          <td className="py-1 pr-4 text-right tabular-nums">{r.cnt}</td>
          <td className="py-1 text-right tabular-nums">{r.pct.toFixed(1)}%</td>
        </tr>
      ))}
    </tbody>
  </table>
)

const DescriptionsTable = ({ descriptions }: { descriptions: CorpusDescription[] }) => (
  <table className="w-full text-xs">
    <thead>
      <tr className="border-b border-neutral-200 text-left text-neutral-500">
        <th className="py-1 pr-4 font-medium">Corpus</th>
        <th className="py-1 pr-4 font-medium">Language</th>
        <th className="py-1 font-medium">Description</th>
      </tr>
    </thead>
    <tbody>
      {descriptions.length === 0 && <EmptyRow label="No corpus descriptions" />}
      {descriptions.map((d) => (
        <tr key={`${d.corpus}|${d.language}`} className="border-b border-neutral-100 align-top">
          <td className="py-1 pr-4 font-mono whitespace-nowrap">{d.corpus}</td>
          <td className="py-1 pr-4 font-mono">{d.language}</td>
          <td className="py-1 text-neutral-600">{d.description}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

const CorpusTable = ({ rows }: { rows: { key: string; count: number }[] }) => (
  <table className="w-full text-xs">
    <thead>
      <tr className="border-b border-neutral-200 text-left text-neutral-500">
        <th className="py-1 pr-4 font-medium">Corpus</th>
        <th className="py-1 font-medium text-right">Files</th>
      </tr>
    </thead>
    <tbody>
      {rows.length === 0 && <EmptyRow label="None" />}
      {rows.map((r) => (
        <tr key={r.key} className="border-b border-neutral-100 align-top">
          <td className="py-1 pr-4 font-mono whitespace-nowrap">{r.key}</td>
          <td className="py-1 text-right tabular-nums">{r.count}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

const countRemappedCorpora = (
  classifications: FileClassification[],
  remaps: LabelRemaps
): { key: string; count: number }[] => {
  const counts = new Map<string, number>()
  for (const { type, subject } of classifications) {
    const mappedType = remaps.types.get(type) ?? type
    const mappedSubject = remaps.subjects.get(subject) ?? subject
    const corpus = toCorpusKey(mappedType, mappedSubject)
    counts.set(corpus, (counts.get(corpus) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

const useCorpusStats = (): CorpusStats => {
  const files = useSyncExternalStore(subscribe, getFiles, getFiles)
  const [languages, setLanguages] = useState<LanguageStatsRow[]>([])

  useEffect(() => {
    const db = getDatabase()
    if (!db) return
    fetchLanguageStats(db).then(setLanguages)
  }, [files])

  const descriptions = getCorpusDescriptions(files)
  const classifications = collectClassifications(files)
  const groups = groupByCorpus(classifications)

  return { languages, descriptions, classifications: groups, totalFiles: classifications.length }
}

const useCorpora = (): CorporaResult & { remapped: { key: string; count: number }[] } => {
  const files = useSyncExternalStore(subscribe, getFiles, getFiles)
  const [state, setState] = useState<
    CorporaResult & { remapped: { key: string; count: number }[] }
  >({
    ...EMPTY_CORPORA_RESULT,
    loading: true,
    remapped: [],
  })

  useEffect(() => {
    let cancelled = false

    const typeCounts = collectTypeCounts(files)
    const subjectCounts = collectSubjectCounts(files)
    const types = filterExcludedLabels([...typeCounts.keys()])
    const subjects = filterExcludedLabels([...subjectCounts.keys()])
    const classifications = collectClassifications(files)

    const baseUrl = getLlmHost()

    Promise.all([
      groupNearbyLabels(types, baseUrl, DEFAULT_CLUSTER_THRESHOLD, typeCounts),
      groupNearbyLabels(subjects, baseUrl, DEFAULT_CLUSTER_THRESHOLD, subjectCounts),
    ]).then(([typeClusters, subjectClusters]) => {
      if (cancelled) return
      const remaps = buildRemaps(typeClusters, subjectClusters)
      const remapped = countRemappedCorpora(classifications, remaps)
      const significant = selectSignificantCorpora(
        remapped.map((r) => ({ corpus: r.key, count: r.count }))
      )
      setState({ remapped, significant, loading: false })
    })

    return () => {
      cancelled = true
    }
  }, [files])

  return state
}

export const DebugStatsTab = () => {
  const stats = useCorpusStats()
  const corpora = useCorpora()
  const [corporaOpen, setCorporaOpen] = useState(false)

  const significantRows = corpora.significant.map((key) => {
    const found = corpora.remapped.find((r) => r.key === key)
    return { key, count: found?.count ?? 0 }
  })

  return (
    <div className="flex-1 overflow-y-auto flex flex-col gap-5 px-3 py-3">
      <div className="flex flex-col gap-2">
        <SectionLabel>Languages</SectionLabel>
        <LanguageTable rows={stats.languages} />
      </div>
      <div className="flex flex-col gap-2">
        <SectionLabel>Corpus Descriptions</SectionLabel>
        <DescriptionsTable descriptions={stats.descriptions} />
      </div>
      <div className="flex flex-col gap-2">
        <SectionLabel>
          Corpora
          {corpora.loading
            ? " (clustering…)"
            : ` (${stats.classifications.length} → ${corpora.significant.length})`}
        </SectionLabel>
        {!corpora.loading && <CorpusTable rows={significantRows} />}
        {!corpora.loading && (
          <button type="button" onClick={() => setCorporaOpen((o) => !o)} className="text-left">
            <span className="text-xs text-neutral-400">
              Original ({stats.classifications.length}) {corporaOpen ? "▾" : "▸"}
            </span>
          </button>
        )}
        {corporaOpen && !corpora.loading && <CorpusTable rows={stats.classifications} />}
      </div>
    </div>
  )
}
