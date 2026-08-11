import { useEffect, useMemo } from "react"
import { useNavigate, useParams } from "react-router"
import { useProject } from "./project"
import { landingFile } from "~/domain/documents/selectors"
import { FilePlus } from "lucide-react"

export default function ProjectIndex() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { files } = useProject()

  const firstAvailableFile = useMemo(() => landingFile(Object.keys(files)), [files])

  useEffect(() => {
    if (firstAvailableFile && projectId) {
      navigate(`/project/${projectId}/file/${encodeURIComponent(firstAvailableFile)}`, {
        replace: true,
      })
    }
  }, [firstAvailableFile, projectId, navigate])

  if (Object.keys(files).length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <FilePlus className="h-12 w-12 text-subtext-color" />
        <div className="text-lg text-default-font">No files yet</div>
        <div className="text-subtext-color">Create a new file to get started</div>
      </div>
    )
  }

  return null
}
