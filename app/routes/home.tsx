import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import type { Route } from "./+types/home"
import { createProject } from "~/domain/projects/create"
import { WelcomeFirstProject } from "~/ui/components/WelcomeFirstProject"
import {
  useProjects,
  getFirstProjectRedirect,
  shouldOfferFirstProject,
} from "~/ui/hooks/useProjects"

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Nabu - Your AI research partner" },
    { name: "description", content: "Qualitative research workspace" },
  ]
}

export default function Home() {
  const navigate = useNavigate()
  const { projects, loading } = useProjects()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const redirect = getFirstProjectRedirect(projects, loading)
    if (redirect) {
      navigate(redirect, { replace: true })
    }
  }, [projects, loading, navigate])

  const create = async () => {
    setCreating(true)
    setError(null)

    const result = await createProject()
    if (!result.ok) {
      setError(result.error)
      setCreating(false)
      return
    }

    navigate(`/project/${result.id}`, { replace: true })
  }

  if (shouldOfferFirstProject(projects, loading)) {
    return (
      <div className="h-screen">
        <WelcomeFirstProject onCreate={() => void create()} creating={creating} error={error} />
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-default-background text-body font-body text-subtext-color">
      Loading projects...
    </div>
  )
}
