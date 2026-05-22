import { executeUxAction } from "~/lib/data-blocks/file-action"
import { SETTINGS_FILE } from "~/lib/files/filename"

export const writeSelectedCodes = (codes: string[]): void => {
  executeUxAction([
    {
      path: SETTINGS_FILE,
      language: "json-ux",
      ops: [{ op: "add", path: "/selectedCodes", value: codes }],
    },
  ])
}
