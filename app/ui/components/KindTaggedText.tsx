import type { ComponentType } from "react"
import { splitKindTags } from "~/lib/regions/kinds/title-tags"
import type { KindDescriptor } from "~/lib/regions/kinds/registry"
import { resolveIcon } from "~/ui/theme/icon-map"
import { lowContrastText } from "~/ui/theme/radix"

const Glyph = ({
  icon: Icon,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
}) => <Icon className="inline-block h-[0.75em] w-[0.75em] align-[-0.05em]" strokeWidth={2.75} />

const KindGlyph = ({ kind }: { kind: KindDescriptor }) => (
  <span aria-label={kind.id} style={{ color: lowContrastText(kind.color) }}>
    <Glyph icon={resolveIcon(kind.icon)} />
  </span>
)

// Renders a title that may carry `:kind:` tags (e.g. ":speaker: rutte"), drawing
// each tag as the kind's icon the way the editor marks it.
export const KindTaggedText = ({ text }: { text: string }) => (
  <>
    {splitKindTags(text).map((part, i) =>
      part.type === "text" ? (
        <span key={i}>{part.text}</span>
      ) : (
        <KindGlyph key={i} kind={part.kind} />
      )
    )}
  </>
)
