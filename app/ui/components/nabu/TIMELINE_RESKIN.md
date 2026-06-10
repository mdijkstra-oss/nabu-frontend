# Chat → Timeline reskin

Working spec. Delete when reskin landed.

## Intent

Move chat pane away from consumer-chat metaphor (bubbles, L/R alignment) toward a **session timeline**: vertical rail, time-ordered event cards, all left-aligned, all full-width. Reads as "what happened in this session", not "Q/A with an assistant".

Future events (file writes, search runs, etc) inline into same stream. **Not in this pass.** This pass is visual reskin only — same `Block[]` source, same grouping, same `useChat` wiring.

## Scope locked

In:

- Replace bubbles with timeline cards.
- Add continuous vertical rail on left of scroll area.
- Add per-card marker on rail: `●` YOU, `○` OTHER. Two markers only.
- Drop outer rounded chrome on `NabuChatSidebar` (pane sits flat).
- Add `Assistant` header (flat).
- Delete scout rendering entirely (separate prior step — see below).

Out:

- No source-of-truth changes. `Block[]` store untouched. `mutation-history` not merged into timeline yet.
- `LastWriteBar` stays as bottom strip above input. No inline file events yet.
- Left sidebar untouched (already flat).
- Doc pane (middle) untouched. Keeps its `rounded-xl` floating-card chrome.
- `AutoScroll` → bottom unchanged.
- `MessageContent` markdown engine unchanged.

## Pre-step: scout removal

Do first, separate commit.

Delete:

- `app/lib/agent/tools/scout/` (entire dir)
- `steering/nudges/` scout-specific nudges (`planAfterScoutNudge`, `scoutBeforePlanNudge`)
- Scout import line in `executors/index.ts` (already commented — remove comment + line)
- `messages.ts` — `ScoutMessage`, `ScoutFileStatus`, `ScoutFileState`, `extractScoutMessages`
- `group.ts` — `ScoutMessage` import + `scoutKeyed` merge
- `NabuChatSidebar.tsx` — `ScoutRenderer`, `scoutPropsEqual`, `scoutFilesEqual`, `groupScoutFiles`, `ScoutFileRow`, `scoutFileIcon`, `ScoutFileGroup`, `ScoutFileRowProps`, `ScoutRendererProps`, `isScoutSegment`, scout branch in render switch, scout types in `RenderSegment`
- Tests: `messages.test.ts` and `group.test.ts` scout cases
- Any docs/comments referencing scout in `ARCHITECTURE.md` §9.5 and auto-memory

After scout removal: codebase compiles, no scout types, no scout dead code (R-XXI).

## Layout graph

```
┌─────────────────────────────────────┐
│  Assistant                          │  ← flat header, no chrome
├─────────────────────────────────────┤
│                                     │
│    │                                │
│    ●─── ┌──────────────────────┐    │  ← YOU marker (filled brand-600)
│    │    │ YOU            15:30 │    │
│    │    │ Help me code these   │    │
│    │    │ passages for valence │    │
│    │    └──────────────────────┘    │
│    │                                │
│    ○─── ┌──────────────────────┐    │  ← OTHER (outline neutral-400)
│    │    │ NABU           15:30 │    │
│    │    │ I'll scan the corpus │    │
│    │    └──────────────────────┘    │
│    │                                │
│    ○─── ┌──────────────────────┐    │
│    │    │ PLAN           15:31 │    │
│    │    │ Code valence across  │    │
│    │    │ 12 interviews        │    │
│    │    ├──────────────────────┤    │
│    │    │ ✓ Identify spans     │    │
│    │    │ ✓ Cluster polarity   │    │
│    │    │ ● Assign codes       │    │
│    │    │ ○ Review borderline  │    │
│    │    └──────────────────────┘    │
│    │                                │
│    ○─── ┌──────────────────────┐    │
│    │    │ QUESTION       15:33 │    │
│    │    │ Borderline cases:    │    │
│    │    │ separate or merge?   │    │
│    │    ├──────────────────────┤    │
│    │    │ ›  Separate code     │    │
│    │    │ ›  Merge nearest     │    │
│    │    └──────────────────────┘    │
│    │                                │
│    ●─── ┌──────────────────────┐    │
│    │    │ YOU            15:33 │    │
│    │    │ Separate code        │    │
│    │    └──────────────────────┘    │
│    │                                │
│    ○─── ┌──────────────────────┐    │
│    │    │ ⟳ thinking…          │    │
│    │    └──────────────────────┘    │
│    │                                │
├─────────────────────────────────────┤
│ ✎  Edited callout-abc in foo.md  ›  │  ← LastWriteBar (unchanged)
├─────────────────────────────────────┤
│  Ask a follow-up…                ▶  │  ← input (unchanged behavior)
└─────────────────────────────────────┘
```

## Component impact

| Current                                                                                  | Reskin                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `NabuChatSidebar` outer `rounded-xl border border-panel-border bg-white overflow-hidden` | flat: `flex w-full grow flex-col bg-transparent` (or no bg)                                                                                     |
| (no header)                                                                              | `Assistant` header bar — flat, padded, no chrome                                                                                                |
| `UserBubble`, `AssistantBubble`, `PlanLeafInline`                                        | collapse → one `TimelineCard` w/ slots: `kind`, `timestamp`, `children`                                                                         |
| `LeafRenderer`                                                                           | wraps `TimelineCard` w/ kind `YOU` or `NABU`                                                                                                    |
| `AskRenderer`                                                                            | `TimelineCard` kind `QUESTION` (brand-accented chip) + `OptionCard` list inside card body, divider above options                                |
| `PlanSegmentRenderer`                                                                    | `TimelineCard` kind `PLAN` + step rows inside (no per-step card), internal dividers between header + steps, `AbortBox` inside card when aborted |
| `PlanStepRow`                                                                            | unchanged JSX shape, now lives inside card body                                                                                                 |
| `TickLabel`                                                                              | `TimelineCard` kind `(none)` w/ spinner + rotating label                                                                                        |
| `CollapsedStepsIndicator`                                                                | small caption row inside card body where it appears                                                                                             |
| `LastWriteBar`                                                                           | unchanged                                                                                                                                       |
| input row                                                                                | unchanged behavior, restyle border/bg to match flat shell                                                                                       |
| `MessageContent`                                                                         | unchanged                                                                                                                                       |
| `OptionCard`                                                                             | unchanged                                                                                                                                       |
| `ScoutRenderer` + all scout types                                                        | deleted (pre-step)                                                                                                                              |

## New components

### `TimelineCard`

```ts
interface TimelineCardProps {
  kind: "YOU" | "NABU" | "QUESTION" | "PLAN" | null // null = no chip (in-flight)
  timestamp: string | null // formatted, null = hidden
  marker: "you" | "other"
  children: ReactNode
}
```

- Outer: `relative pl-8` (clears rail + marker)
- Card: `rounded-xl border border-neutral-200 bg-white px-4 py-3`
- Header row: `flex items-center justify-between mb-2` — kind chip left, timestamp right
- Kind chip variants:
  - `YOU` / `NABU` / `PLAN`: `text-caption font-caption text-subtext-color tracking-wide` (or small chip border, TBD palette)
  - `QUESTION`: same shape, `text-brand-700 border-brand-300 bg-brand-50`
- Marker: absolute, positioned on rail at card top — `absolute left-6 top-4 -translate-x-1/2 w-2.5 h-2.5 rounded-full`
  - `you`: `bg-brand-600`
  - `other`: `border border-neutral-400 bg-white`

### `TimelineRail`

```ts
interface TimelineRailProps {
  children: ReactNode
}
```

- Outer scroll container w/ rail overlay
- Rail: `absolute left-6 top-0 bottom-0 w-px bg-neutral-200`
- Continuous across whole scroll height. Markers (inside cards) overlay rail at correct y-positions.

## Open decisions

- **Timestamp format.** Absolute `15:30`, relative `2m ago`, hover-only, or both? Default proposal: absolute `HH:mm`, hover shows full date.
- **Chip palette.** Caption-style text only, or bordered pill? Mockup shows bordered pill w/ left accent — match exactly?
- **Header text** ("Assistant"). Editable / contextual ("Nabu") / always literal "Assistant"?
- **Streaming card.** Mid-stream renders as `NABU` card filling in (preferred), or stays as separate spinner pill (`TickLabel` as today)?
- **Input row chrome.** Drop top border too (fully flush), or keep separator above input?
- **Plan internal divider.** `border-t border-neutral-100` between header and steps, or no divider?

## Files touched (reskin pass)

| File                                         | Layer | Action                                                                                      |
| -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `app/ui/components/nabu/NabuChatSidebar.tsx` | ui    | modify (drop outer chrome, swap bubbles for `TimelineCard`, add `TimelineRail`, add header) |
| `app/ui/components/nabu/TimelineCard.tsx`    | ui    | create                                                                                      |
| `app/ui/components/nabu/TimelineRail.tsx`    | ui    | create                                                                                      |
| `app/ui/components/nabu/TIMELINE_RESKIN.md`  | (doc) | delete after landing                                                                        |

`group.ts`, `messages.ts`, `useChat.ts`, `derived/`, `client/store.ts` — **not touched**.

## Reuse audit (placeholder — fill in before implementation)

- `OptionCard` (NabuChatSidebar.tsx:297) — exists, reuse inside QUESTION card
- `MessageContent` (NabuChatSidebar.tsx:93) — exists, reuse for card body
- `InlineMarkdown` — exists, reuse for option labels
- `AbortBox` (`ai/StepsBlock.tsx`) — exists, reuse inside plan card
- `AutoScroll`, `AnimatedListItem`, `AnimatePresence` — exist, reuse
- `TimelineCard`, `TimelineRail` — new, nothing similar found

## Order

1. **Scout deletion** — separate commit.
2. **Reskin** — second commit. Implements timeline cards + rail + flat outer + header.
3. Delete this file.
