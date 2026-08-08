import { useEffect, useState } from "react"
import { getProjects, type Project } from "~/lib/server/api/queries"

interface UseProjectsResult {
  projects: Project[]
  loading: boolean
  error: Error | null
}

export const useProjects = (): UseProjectsResult => {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const result = await getProjects({ page_size: 100 })
        setProjects(result.items)
      } catch (e) {
        const failure = e instanceof Error ? e : new Error(String(e))
        console.error("[projects] failed to load", failure)
        setError(failure)
      } finally {
        setLoading(false)
      }
    }
    loadProjects()
  }, [])

  return { projects, loading, error }
}

export const getFirstProjectId = (projects: Project[]): string | null =>
  projects.length > 0 ? projects[0].id : null

export const getFirstProjectRedirect = (projects: Project[], loading: boolean): string | null => {
  const firstId = getFirstProjectId(projects)
  return !loading && firstId ? `/project/${firstId}` : null
}
