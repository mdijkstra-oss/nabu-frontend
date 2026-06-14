import { getFileRaw, updateFileRaw } from "./store"
import { pushEntries } from "~/lib/mutation-history/store"
import { diffFileContent } from "~/lib/mutation-history/diff"
import type { HistoryActor } from "~/lib/mutation-history/types"

export const writeFileTracked = (path: string, content: string, actor: HistoryActor): void => {
  const oldContent = getFileRaw(path)
  updateFileRaw(path, content)
  pushEntries(diffFileContent(oldContent, content, path, Date.now(), actor))
}
