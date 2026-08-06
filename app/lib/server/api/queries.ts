import { getApiUrl } from "../env"

export interface Project {
  id: string
  updatedAt: string
}

interface PaginationQuery {
  page?: number
  page_size?: number
}

interface PaginationResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

const buildQueryString = (params: object): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return ""
  return "?" + entries.map(([k, v]) => `${k}=${v}`).join("&")
}

const fetchQuery = async <T>(path: string): Promise<T> => {
  const url = getApiUrl(path)
  const response = await fetch(url)

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}${suffix(body)}`)
  }

  return response.json()
}

const suffix = (body: string): string => (body ? ` — ${body.slice(0, 500)}` : "")

export const getProjects = (query: PaginationQuery = {}): Promise<PaginationResult<Project>> =>
  fetchQuery(`/queries/projects${buildQueryString(query)}`)
