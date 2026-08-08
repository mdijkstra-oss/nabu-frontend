import { useEffect } from "react"
import { useNavigate } from "react-router"
import type { Route } from "./+types/home"
import { useProjects, getFirstProjectRedirect } from "~/ui/hooks/useProjects"

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Nabu - Your AI research partner" },
    { name: "description", content: "Qualitative research workspace" },
  ]
}

export default function Home() {
  const navigate = useNavigate()
  const { projects, loading } = useProjects()

  useEffect(() => {
    const redirect = getFirstProjectRedirect(projects, loading)
    if (redirect) {
      navigate(redirect, { replace: true })
    }
  }, [projects, loading, navigate])

  return (
    <div className="flex h-screen items-center justify-center text-muted-foreground">
      {loading ? "Loading projects..." : "No projects found"}
    </div>
  )
}
