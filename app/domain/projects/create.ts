import { sendCommand } from "~/lib/server/sync/commands"
import type { Command } from "~/lib/server/sync/types"

export const welcomePath = "welcome.md"

export const welcomeContent = `# Welcome to your new project

Every document here is a plain Markdown file. Edit this one, add another, or
delete it — it is all yours.
`

// Storage has no create-project call. A project directory comes into existence
// with its first file write, under a UUID the client picks; the required
// preferences and settings files are storage's own on first connect.
export const firstFileCommand = (): Command => ({
  action: "WriteFile",
  path: welcomePath,
  content: welcomeContent,
})

export type CreateProjectResult = { ok: true; id: string } | { ok: false; error: string }

export const createProject = async (): Promise<CreateProjectResult> => {
  const id = crypto.randomUUID()
  const result = await sendCommand(id, firstFileCommand())
  return result.ok ? { ok: true, id } : result
}
