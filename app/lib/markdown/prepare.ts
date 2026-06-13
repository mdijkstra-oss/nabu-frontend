import { linkifyEntityIds } from "~/lib/markdown/linkify/entities"
import { linkifyQuotes } from "~/lib/markdown/linkify/quotes"
import { normalizeBacktickQuotes } from "~/lib/markdown/sanitize/normalize-backticks"
import { normalizeEntityIdSeparators } from "~/lib/markdown/sanitize/normalize-entity-id-separators"
import { stripHiddenSuffix, stripEntityQuotes } from "~/lib/markdown/sanitize/strip-hidden"
import { stripEntityLinks } from "~/lib/markdown/sanitize/strip-entity-links"
import { unwrapBacktickEntities } from "~/lib/markdown/sanitize/unwrap-backtick-entities"
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
        unwrapBacktickEntities(
          stripEntityLinks(stripEntityQuotes(stripHiddenSuffix(normalizeEntityIdSeparators(text))))
        ),
        resolveName,
        boldMissingFile
      )
    ),
    currentFile,
    currentFileContent
  )
