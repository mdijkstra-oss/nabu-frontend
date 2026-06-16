import type { HistoryEntry } from "~/lib/mutation-history/types"
import { actorIcon, presentEntry } from "~/lib/mutation-history/presentation"
import { summarizeEdits } from "~/lib/mutation-history/summarize"
import { toDisplayName } from "~/lib/files/filename"
import type { EditGroupMessage } from "./group"
import { TimelineCard } from "./TimelineCard"
import { CollapsibleGroupCard, successTone } from "./CollapsibleGroupCard"

const editKindClass = "text-[11px] font-bold uppercase tracking-[0.08em] text-success-600"

interface EditRowProps {
  entry: HistoryEntry
  onSelectFile: (path: string) => void
}

const EditRow = ({ entry, onSelectFile }: EditRowProps) => {
  const { icon: Icon, verbLabel, entityLabel } = presentEntry(entry)
  return (
    <button
      onClick={() => onSelectFile(entry.path)}
      className="flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-success-600/10"
    >
      <Icon className="text-success-600 w-3.5 h-3.5 flex-none" />
      <span className="text-caption font-caption text-success-700 truncate">
        {verbLabel}: {entityLabel}
      </span>
      <span className="text-caption font-caption text-success-700/60 truncate">
        {toDisplayName(entry.path)}
      </span>
    </button>
  )
}

interface EditGroupCardProps {
  message: EditGroupMessage
  onSelectFile: (path: string) => void
}

export const EditGroupCard = ({ message, onSelectFile }: EditGroupCardProps) => {
  const { entries, actor, timestamp } = message
  const Glyph = actorIcon[actor]
  return (
    <TimelineCard kind="Edits" marker="edit" timestamp={timestamp} kindClassName={editKindClass}>
      <CollapsibleGroupCard
        tone={successTone}
        glyph={<Glyph className="h-3.5 w-3.5" />}
        summary={summarizeEdits(entries)}
        expandable={entries.length > 1}
        onSummaryClick={() => onSelectFile(entries[0].path)}
      >
        {entries.map((entry, index) => (
          <EditRow
            key={`${entry.entityId ?? entry.path}-${index}`}
            entry={entry}
            onSelectFile={onSelectFile}
          />
        ))}
      </CollapsibleGroupCard>
    </TimelineCard>
  )
}
