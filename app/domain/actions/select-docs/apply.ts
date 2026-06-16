import { executeUxAction } from "~/lib/data-blocks/file-action"
import { SETTINGS_FILE } from "~/lib/files/filename"

export const writeSelectedDocs = (docs: string[]): void => {
  executeUxAction([
    {
      path: SETTINGS_FILE,
      language: "json-ux",
      ops: [{ op: "add", path: "/selectedDocs", value: docs }],
    },
  ])
}
