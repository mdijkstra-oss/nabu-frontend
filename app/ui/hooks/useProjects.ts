import { useEffect, useState } from "react"
import { getProjects, type ProjectSummary } from "~/lib/server/api/queries"

interface UseProjectsResult {
  projects: ProjectSummary[]
  loading: boolean
  error: Error | null
}

export const useProjects = (): UseProjectsResult => {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const result = await getProjects({ page_size: 100 })
        setProjects(result.items)
      } catch (e) {
        setError(e instanceof Error ? e : new Error("Failed to load projects"))
      } finally {
        setLoading(false)
      }
    }
    loadProjects()
  }, [])

  return { projects, loading, error }
}

export const findProjectById = (
  projects: ProjectSummary[],
  id: string | null
): ProjectSummary | undefined => projects.find((p) => p.id === id)

export const shouldAutoSelect = (
  projects: ProjectSummary[],
  currentValue: string | null
): boolean => projects.length > 0 && !currentValue

export const getFirstProjectId = (projects: ProjectSummary[]): string | null =>
  projects.length > 0 ? projects[0].id : null

type SelectorState = "loading" | "error" | "empty" | "ready"

export const resolveState = (
  loading: boolean,
  error: Error | null,
  projects: ProjectSummary[]
): SelectorState => {
  if (loading) return "loading"
  if (error) return "error"
  if (projects.length === 0) return "empty"
  return "ready"
}
