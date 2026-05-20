import { RefineCodeArgs, refineCodeTool, REFINE_CODE_ENDPOINT } from "./def"
import { registerTool, tool } from "../../executors/tool"
import { getFileView } from "../file-view"
import { getFiles } from "~/lib/files/store"
import { GENERATED_SUFFIX } from "~/lib/files/filename"
import { callLlm } from "../../client/fetch"
import { extractText } from "../../client/convert"
import {
  collectReviewedAnnotations,
  collectCleanAnnotations,
  collectOtherCodes,
  buildRefineMessages,
  buildInstructionTail,
} from "./messages"

const toHiddenPath = (calloutId: string): string => `${calloutId}${GENERATED_SUFFIX}`

registerTool(
  tool({
    ...refineCodeTool,
    schema: RefineCodeArgs,
    handler: async (_files, { callout_id, guidance, general_codebook_file }) => {
      let generalContent: string | undefined
      if (general_codebook_file) {
        generalContent = getFileView(general_codebook_file)
        if (generalContent === undefined)
          return {
            status: "error",
            output: `General codebook file not found: ${general_codebook_file}`,
            mutations: [],
          }
      }

      const hiddenPath = toHiddenPath(callout_id)
      const codeContent = getFileView(hiddenPath)
      if (codeContent === undefined)
        return {
          status: "error",
          output: `Code definition not found for callout: ${callout_id} (looked for ${hiddenPath})`,
          mutations: [],
        }

      const files = getFiles()
      const flagged = collectReviewedAnnotations(files, callout_id)
      if (flagged.length === 0)
        return {
          status: "ok",
          output: `No reviewed annotations found for code ${callout_id}. Nothing to refine against — run apply_deep_analysis first to generate codings with review feedback.`,
          mutations: [],
        }

      const clean = collectCleanAnnotations(files, callout_id, flagged.length)
      const otherCodes = collectOtherCodes(files, callout_id)
      const messages = buildRefineMessages(
        codeContent,
        flagged,
        clean,
        otherCodes,
        guidance,
        generalContent
      )

      const blocks = await callLlm({ endpoint: REFINE_CODE_ENDPOINT, messages })
      const analysis = extractText(blocks)

      if (!analysis)
        return { status: "error", output: "Refine agent returned no response", mutations: [] }

      const tail = buildInstructionTail(callout_id)

      return {
        status: "ok",
        output: `## Refinement Analysis for \`${callout_id}\`\n\n${analysis}\n\n${tail}`,
        mutations: [],
      }
    },
  })
)
