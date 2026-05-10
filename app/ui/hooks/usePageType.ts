import { useParams } from "react-router"

export type PageType = "document" | "search" | "none"

export const usePageType = (): PageType => {
  const params = useParams<{ fileId?: string; searchId?: string }>()
  if (params.searchId) return "search"
  if (params.fileId) return "document"
  return "none"
}

export const useIsOnDocumentPage = (): boolean => usePageType() === "document"
export const useIsOnSearchPage = (): boolean => usePageType() === "search"
