import { z } from "zod"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { toSystem } from "~/lib/agent/client/convert"
import { HydeListSchema, type HydeAngle } from "./hyde-schema"

const FileHydeResponseSchema = z.object({
  highlight: z.string(),
  hydes: HydeListSchema,
})

export interface FileHydeResult {
  highlight: string
  inclusions: HydeAngle[]
}

const FILE_HYDE_ENDPOINT = "/file-hyde"

const formatCallToAction = (language: string): string =>
  `Generate the highlight and passages now in ${language}. Return valid JSON only.`

export const generateFileHydes = async (
  fileContent: string,
  filename: string,
  language: string
): Promise<FileHydeResult> => {
  const result = await callAndParse(
    FILE_HYDE_ENDPOINT,
    [
      toSystem(`<file name="${filename}">\n${fileContent}\n</file>`),
      toSystem(`language: ${language}`),
      toSystem(formatCallToAction(language)),
    ],
    FileHydeResponseSchema
  )

  if (!result.ok) throw new Error(`File HyDE generation failed: ${result.error}`)

  return {
    highlight: result.data.highlight,
    inclusions: result.data.hydes,
  }
}
