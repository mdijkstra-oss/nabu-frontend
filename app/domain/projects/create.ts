import { sendCommand } from "~/lib/server/sync/commands"
import type { Command } from "~/lib/server/sync/types"

export const welcomePath = "welcome.md"

// The annotations are here to be seen, not to mean anything: a new project has no
// codebook, so they carry a colour and point at prose further down the page.
export const welcomeContent = `# Welcome

This is a document, and it is a plain Markdown file. So is everything else in this project — your notes, your codebook, the charts you draw from them. Nothing is kept anywhere else.

Some of the text below is highlighted. That is an annotation: a span of text, a colour, and a reason attached to it. Make one by selecting a phrase yourself, or ask for a pass over a whole document and get them back by the hundred.

## Things to try

* **Bring in your material.** Interviews, transcripts, field notes — anything that reads as text.
* **Ask a question.** The chat searches every document you have and quotes the passage it answered from, so you can go and check it.
* **Build a codebook.** Say what you are looking for, let a coding pass mark it across the corpus, and see where two models read the same sentence differently.
* **Draw a chart.** Ask for one and it keeps the query rather than the numbers, so it stays true as the corpus grows.

## About this file

Nothing depends on it. Rename it, write over it, or delete it once you have somewhere better to start.

\`\`\`json-annotations
{
	"annotations": [
		{
			"text": "quotes the passage it answered from",
			"reason": "Every answer points back at the text it came from, so nothing has to be taken on trust.",
			"color": "jade",
			"id": "annotation-1a2b3c4d"
		},
		{
			"text": "it keeps the query rather than the numbers",
			"reason": "A chart re-runs itself, so it describes the corpus you have rather than the one you had.",
			"color": "indigo",
			"id": "annotation-2f7k9m3q"
		}
	]
}
\`\`\`
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
