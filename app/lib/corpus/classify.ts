import { z } from "zod"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { toSystem, toUser } from "~/lib/agent/client/convert"

const ENDPOINT = "/topic-assigner"

export interface Classification {
  type: string
  subject: string
}

export interface ExistingClassifications {
  types: string[]
  subjects: string[]
}

const ClassificationSchema = z.object({
  type: z.string().describe("document type, 1-3 words"),
  subject: z.string().describe("document subject, 1-3 words"),
})

const formatList = (items: string[]): string =>
  items.length === 0 ? "(none yet)" : [...items].sort().join(", ")

const buildExistingMessage = (existing: ExistingClassifications): string =>
  `Existing types: ${formatList(existing.types)}\nExisting subjects: ${formatList(existing.subjects)}`

const CALL_TO_ACTION =
  "Classify the document above. Reuse an existing type and subject from the lists provided if any fit reasonably. Only create new labels if nothing existing applies."

const lowercaseClassification = (c: Classification): Classification => ({
  type: c.type.toLowerCase(),
  subject: c.subject.toLowerCase(),
})

export const classifyDocument = async (
  excerpt: string,
  existing: ExistingClassifications
): Promise<Classification | null> => {
  const result = await callAndParse(
    ENDPOINT,
    [toSystem(buildExistingMessage(existing)), toSystem(excerpt), toUser(CALL_TO_ACTION)],
    ClassificationSchema
  )

  if (!result.ok) {
    console.warn(`[classify] ${result.error}`)
    return null
  }

  return lowercaseClassification(result.data)
}
