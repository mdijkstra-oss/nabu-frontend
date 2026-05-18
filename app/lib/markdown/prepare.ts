import { linkifyEntityIds } from "~/lib/markdown/linkify/entities"
import { linkifyQuotes } from "~/lib/markdown/linkify/quotes"
import { normalizeBacktickQuotes } from "~/lib/markdown/sanitize/normalize-backticks"
import { stripHiddenSuffix, stripEntityQuotes } from "~/lib/markdown/sanitize/strip-hidden"
import { stripEntityLinks } from "~/lib/markdown/sanitize/strip-entity-links"
import { boldMissingFile } from "~/lib/files/filename"

type NameResolver = (id: string) => string | null

export const prepareEntityMarkdown = (
  text: string,
  resolveName: NameResolver,
  currentFile: string | null,
  currentFileContent: string | null
): string =>
  linkifyQuotes(
    normalizeBacktickQuotes(
      linkifyEntityIds(
        stripEntityLinks(stripEntityQuotes(stripHiddenSuffix(text))),
        resolveName,
        boldMissingFile
      )
    ),
    currentFile,
    currentFileContent
  )
