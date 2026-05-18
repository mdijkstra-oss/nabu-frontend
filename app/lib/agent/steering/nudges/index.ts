import type { FileStore } from "~/lib/files/store"
import type { Nudger } from "../nudge-tools"
import { shellNudge } from "./shell"
import { planAfterScoutNudge } from "./plan-after-scout"
import { scoutBeforePlanNudge } from "./scout-before-plan"
import { askBeforeSubmitNudge } from "./ask-before-submit"

export const buildToolNudges = (_getFiles: () => FileStore): Record<string, Nudger[]> => ({
  run_local_shell: [shellNudge],
  scout: [planAfterScoutNudge],
  start_planning: [scoutBeforePlanNudge, askBeforeSubmitNudge],
})
