import { useState, useEffect, useRef } from "react"
import { refreshHitsAsync } from "~/lib/search/refresh"
import { useThrottledValue } from "./useThrottledValue"
import type { SearchHit } from "~/domain/search/types"
import type { FileStore } from "~/lib/files/store"

interface RefreshedHits {
  source: SearchHit[]
  output: SearchHit[]
}

export const useLiveHits = (hits: SearchHit[], files: FileStore, enabled: boolean): SearchHit[] => {
  const throttledFiles = useThrottledValue(files, 500)
  const hitsRef = useRef(hits)
  useEffect(() => {
    hitsRef.current = hits
  })
  const prevFilesRef = useRef<FileStore | undefined>(undefined)
  const [refreshed, setRefreshed] = useState<RefreshedHits | null>(null)

  useEffect(() => {
    if (!enabled) return
    const startingHits = hitsRef.current
    const prevFiles = prevFilesRef.current
    prevFilesRef.current = throttledFiles
    let cancelled = false
    const isCancelled = () => cancelled

    refreshHitsAsync(startingHits, throttledFiles, isCancelled, prevFiles).then((output) => {
      if (cancelled) return
      if (output === startingHits) return
      setRefreshed({ source: startingHits, output })
    })

    return () => {
      cancelled = true
    }
  }, [throttledFiles, enabled])

  return enabled && refreshed && refreshed.source === hits ? refreshed.output : hits
}
