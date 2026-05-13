import { getFileRaw, updateFileRaw } from "./store"
import { pushEntries } from "~/lib/mutation-history/store"
import { diffFileContent } from "~/lib/mutation-history/diff"

export const writeFileTracked = (path: string, content: string): void => {
  const oldContent = getFileRaw(path)
  updateFileRaw(path, content)
  pushEntries(diffFileContent(oldContent, content, path, Date.now()))
}
