"use client"

import { NotebookPen } from "lucide-react"
import { Button } from "~/ui/components/Button"
import { IconWithBackground } from "~/ui/components/IconWithBackground"

interface WelcomeFirstProjectProps {
  onCreate: () => void
  creating?: boolean
  error?: string | null
}

export const WelcomeFirstProject = ({
  onCreate,
  creating = false,
  error = null,
}: WelcomeFirstProjectProps) => (
  <div className="flex h-full w-full flex-col items-center justify-center bg-default-background px-12 py-12 mobile:px-6 mobile:py-6">
    <div className="flex w-full max-w-[384px] flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-6">
        <IconWithBackground variant="brand" size="x-large" icon={<NotebookPen />} />
        <div className="flex flex-col items-center gap-2">
          <span className="text-heading-1 font-heading-1 text-default-font text-center mobile:text-heading-2 mobile:font-heading-2">
            Welcome to Nabu
          </span>
          <span className="text-body font-body text-subtext-color text-center">
            Looks like you are about to start your first project. It holds plain Markdown files —
            yours to edit, move, or delete.
          </span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button size="large" loading={creating} disabled={creating} onClick={onCreate}>
          Create my first project
        </Button>
        {error ? (
          <span className="text-caption font-caption text-error-700 text-center">{error}</span>
        ) : null}
      </div>
    </div>
  </div>
)
