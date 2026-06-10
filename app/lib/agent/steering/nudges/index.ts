import type { FileStore } from "~/lib/files/store"
import type { Nudger } from "../nudge-tools"
import { shellNudge } from "./shell"
import { askBeforeSubmitNudge } from "./ask-before-submit"
import { createStepAfterAskNudge } from "./step-after-ask"

export const buildToolNudges = (getFiles: () => FileStore): Record<string, Nudger[]> => ({
  run_local_shell: [shellNudge],
  start_planning: [askBeforeSubmitNudge],
  ask: [createStepAfterAskNudge(getFiles)],
})
