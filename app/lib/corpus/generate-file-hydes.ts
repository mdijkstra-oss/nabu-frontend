import { z } from "zod"
import { callAndParse } from "~/lib/agent/client/call-parse"
import { toSystem } from "~/lib/agent/client/convert"

export const FileHydeResponseSchema = z.object({
  highlight: z.string(),
  inclusions: z.array(z.string()).min(3).max(5),
})

export type FileHydeResponse = z.infer<typeof FileHydeResponseSchema>

const FILE_HYDE_ENDPOINT = "/file-hyde"

const formatCallToAction = (language: string): string =>
  `Generate the highlight and inclusion passages now in ${language}. Return valid JSON only.`

export const generateFileHydes = async (
  fileContent: string,
  filename: string,
  language: string
): Promise<FileHydeResponse> => {
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

  return result.data
}
