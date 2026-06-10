"use client"

import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  memo,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { useNavigate, useParams } from "react-router"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, ChevronRight, Circle, Loader2, MessageSquare, X } from "lucide-react"
import { TextFieldUnstyled } from "~/ui/components/TextFieldUnstyled"
import { AnimatePresence } from "framer-motion"
import { AutoScroll } from "~/ui/components/AutoScroll"
import { AnimatedListItem } from "~/ui/components/AnimatedListItem"
import { useChat } from "~/ui/hooks/useChat"
import { derive, hasActivePlan, isCurrentStepCheckpoint } from "~/lib/agent/derived"
import { pushBlocks } from "~/lib/agent/client/store"
import {
  toGroupedMessages,
  type GroupedMessage,
  type KeyedMessage,
  type LeafMessage,
  type PlanHeader,
  type PlanItem,
  type PlanChild,
  type PlanStep,
  type StepStatus,
} from "./group"
import type { AskMessage } from "./messages"
import { isWaitingForAsk } from "./messages"
import { getSpinnerLabels, LABEL_ADVANCE_MS } from "./spinnerLabel"
import { useFiles } from "~/ui/hooks/useFiles"
import { preprocessStreaming } from "~/lib/markdown/sanitize/partial"
import { AbortBox } from "~/ui/components/ai/StepsBlock"
import { createEntityLinkComponents } from "~/ui/components/markdown/createEntityLinkComponents"
import { linkifyTags } from "~/lib/markdown/linkify/tags"
import { fixMarkdownUrls } from "~/lib/markdown/sanitize/fix-urls"
import { findTagDefinitionByLabel } from "~/domain/data-blocks/settings/tags/selectors"
import { resolveEntityName } from "~/lib/files/selectors"
import { truncateLabel, presentEntry } from "~/lib/mutation-history/presentation"
import { useMutationHistory } from "~/lib/mutation-history/useMutationHistory"
import type { HistoryEntry } from "~/lib/mutation-history/types"
import { prepareEntityMarkdown } from "~/lib/markdown/prepare"
import { InlineMarkdown } from "~/ui/components/InlineMarkdown"
import { autoGreetingDirective } from "~/lib/agent/actions/actions"
import { buildFileContextBlocks } from "~/lib/agent/context-blocks"
import { pickGreeting } from "./greetings"
import { exhaustive } from "~/lib/utils/exhaustive"
import { ChatSendButton, deriveChatButtonMode } from "./ChatSendButton"

const allowFileProtocol = (url: string): string => url

interface MessageContentProps {
  content: string
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

const resolveAndTruncateName = (files: Record<string, string>, id: string): string | null => {
  const name = resolveEntityName(files, id)
  return name ? truncateLabel(name) : null
}

const resolveTagForLinkify = (
  files: Record<string, string>,
  label: string
): { id: string; display: string } | null => {
  const def = findTagDefinitionByLabel(files, label)
  return def ? { id: def.id, display: def.display } : null
}

const remarkPlugins = [remarkGfm]

const ScrollableTable = ({
  _node,
  ...props
}: React.ComponentProps<"table"> & { _node?: unknown }) => (
  <div className="overflow-x-auto">
    <table {...props} />
  </div>
)

const MessageContent = memo(
  ({
    content,
    files,
    projectId,
    currentFile,
    currentFileContent,
    navigate,
  }: MessageContentProps) => {
    const components = useMemo(
      () => ({
        ...createEntityLinkComponents({ files, projectId, navigate }),
        table: ScrollableTable,
      }),
      [files, projectId, navigate]
    )
    return (
      <Markdown
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={allowFileProtocol}
      >
        {fixMarkdownUrls(
          linkifyTags(
            prepareEntityMarkdown(
              content,
              (id) => resolveAndTruncateName(files, id),
              currentFile,
              currentFileContent
            ),
            (label) => resolveTagForLinkify(files, label)
          )
        )}
      </Markdown>
    )
  }
)

const UserBubble = ({
  children,
  scrollOnMount = false,
}: {
  children: React.ReactNode
  scrollOnMount?: boolean
}) => {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!scrollOnMount) return
    ref.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [scrollOnMount])
  return (
    <div ref={ref} className="flex w-full items-end justify-end">
      <div className="flex flex-col items-start rounded-2xl bg-brand-200 px-4 py-2 shadow-sm max-w-[95%]">
        <div className="prose prose-sm text-body font-body text-default-font [&>*]:mb-2 [&>*:last-child]:mb-0 [&_a]:text-brand-700 [&_a]:no-underline [&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-sm [&_h4]:!text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold">
          {children}
        </div>
      </div>
    </div>
  )
}

const AssistantBubble = ({ children }: { children: React.ReactNode }) => (
  <div className="flex w-full items-start">
    <div className="flex flex-col items-start rounded-2xl bg-neutral-100 px-4 py-2 max-w-[95%]">
      <div className="prose prose-sm text-body font-body text-default-font [&>*]:mb-2 [&>*:last-child]:mb-0 [&_a]:no-underline [&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-sm [&_h4]:!text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold">
        {children}
      </div>
    </div>
  </div>
)

const stepIconComponent: Record<StepStatus, React.ComponentType<{ className?: string }>> = {
  completed: Check,
  active: Circle,
  pending: Circle,
  cancelled: X,
}

const stepIconColor: Record<StepStatus, string> = {
  completed: "text-success-600",
  active: "text-brand-600",
  pending: "text-neutral-400",
  cancelled: "text-neutral-400",
}

const stepTextColor: Record<StepStatus, string> = {
  completed: "text-default-font",
  active: "text-default-font",
  pending: "text-neutral-400",
  cancelled: "text-neutral-400",
}

interface PlanStepRowProps {
  step: PlanStep
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

const PlanStepRow = ({
  step,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
}: PlanStepRowProps) => {
  const Icon = step.checkpoint ? MessageSquare : stepIconComponent[step.status]
  return (
    <div className="flex w-full items-start gap-2">
      <Icon className={`text-body ${stepIconColor[step.status]} mt-0.5 flex-none`} />
      <div className="flex grow shrink-0 basis-0 flex-col items-start gap-1">
        <div
          className={`prose prose-sm [&>*]:mb-0 [&_a]:no-underline text-body font-body ${stepTextColor[step.status]}`}
        >
          <MessageContent
            content={step.description}
            files={files}
            projectId={projectId}
            currentFile={currentFile}
            currentFileContent={currentFileContent}
            navigate={navigate}
          />
        </div>
      </div>
    </div>
  )
}

const displayContent = (message: LeafMessage): string | null =>
  message.draft ? preprocessStreaming(message.content) : message.content

interface LeafRendererProps {
  message: LeafMessage
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
  isLast?: boolean
}

const leafPropsEqual = (prev: LeafRendererProps, next: LeafRendererProps): boolean =>
  prev.message.content === next.message.content &&
  prev.message.role === next.message.role &&
  prev.message.draft === next.message.draft &&
  prev.files === next.files &&
  prev.projectId === next.projectId &&
  prev.currentFile === next.currentFile &&
  prev.currentFileContent === next.currentFileContent &&
  prev.navigate === next.navigate &&
  prev.isLast === next.isLast

const LeafRenderer = memo(
  ({
    message,
    files,
    projectId,
    currentFile,
    currentFileContent,
    navigate,
    isLast,
  }: LeafRendererProps) => {
    const content = displayContent(message)
    if (!content) return null
    if (message.role === "user") {
      return (
        <UserBubble scrollOnMount={isLast}>
          <MessageContent
            content={content}
            files={files}
            projectId={projectId}
            currentFile={currentFile}
            currentFileContent={currentFileContent}
            navigate={navigate}
          />
        </UserBubble>
      )
    }
    return (
      <AssistantBubble>
        <MessageContent
          content={content}
          files={files}
          projectId={projectId}
          currentFile={currentFile}
          currentFileContent={currentFileContent}
          navigate={navigate}
        />
      </AssistantBubble>
    )
  },
  leafPropsEqual
)

interface OptionCardProps {
  children: ReactNode
  selected: boolean
  dimmed: boolean
  onClick?: () => void
}

const OptionCard = ({ children, selected, dimmed, onClick }: OptionCardProps) => {
  const className = [
    "flex w-full items-center gap-2 rounded-lg border-2 px-3 py-2",
    selected
      ? "border-brand-600 bg-brand-50"
      : dimmed
        ? "border-neutral-border bg-white opacity-50"
        : "border-neutral-border bg-white cursor-pointer hover:border-brand-600 hover:bg-brand-50 [&:hover_.option-icon]:hidden [&:hover_.option-check]:block",
  ].join(" ")

  const icon = selected ? (
    <Check className="text-brand-600 flex-none" />
  ) : (
    <>
      <ChevronRight className="option-icon text-neutral-400 flex-none" />
      <Check className="option-check hidden text-brand-600 flex-none" />
    </>
  )

  const text = (
    <span className="grow text-left text-body font-body text-default-font pointer-events-none">
      {children}
    </span>
  )

  if (selected)
    return (
      <div className={className}>
        {icon}
        {text}
      </div>
    )

  return (
    <button onClick={onClick} disabled={dimmed} className={className}>
      {icon}
      {text}
    </button>
  )
}

interface AskRendererProps {
  message: AskMessage
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
  onSelect: (option: string) => void
  isLast?: boolean
}

const isTypedAnswer = (message: AskMessage): boolean =>
  message.selected !== null && !message.options.some((o) => o.label === message.selected)

const hasOptions = (message: AskMessage): boolean => message.options.length > 0

const askPropsEqual = (prev: AskRendererProps, next: AskRendererProps): boolean =>
  prev.message.question === next.message.question &&
  prev.message.selected === next.message.selected &&
  prev.message.options.length === next.message.options.length &&
  prev.files === next.files &&
  prev.projectId === next.projectId &&
  prev.currentFile === next.currentFile &&
  prev.currentFileContent === next.currentFileContent &&
  prev.navigate === next.navigate &&
  prev.onSelect === next.onSelect &&
  prev.isLast === next.isLast

const AskRenderer = memo(
  ({
    message,
    files,
    projectId,
    currentFile,
    currentFileContent,
    navigate,
    onSelect,
    isLast,
  }: AskRendererProps) => (
    <div className="flex w-full flex-col items-start gap-2 mb-3">
      <AssistantBubble>
        <MessageContent
          content={message.question}
          files={files}
          projectId={projectId}
          currentFile={currentFile}
          currentFileContent={currentFileContent}
          navigate={navigate}
        />
      </AssistantBubble>
      {hasOptions(message) && (
        <div className="flex w-full flex-col gap-1.5 max-w-[95%]">
          {message.options.map((option) => {
            const selected = message.selected === option.label
            return (
              <OptionCard
                key={option.label}
                selected={selected}
                dimmed={message.selected !== null && !selected}
                onClick={message.selected === null ? () => onSelect(option.label) : undefined}
              >
                <InlineMarkdown
                  files={files}
                  projectId={projectId}
                  currentFile={currentFile}
                  currentFileContent={currentFileContent}
                >
                  {option.label}
                </InlineMarkdown>
              </OptionCard>
            )
          })}
        </div>
      )}
      {isTypedAnswer(message) && (
        <UserBubble scrollOnMount={isLast}>
          <MessageContent
            content={message.selected ?? ""}
            files={files}
            projectId={projectId}
            currentFile={currentFile}
            currentFileContent={currentFileContent}
            navigate={navigate}
          />
        </UserBubble>
      )}
    </div>
  ),
  askPropsEqual
)

const isPlanStep = (child: PlanChild): child is PlanStep => child.type === "plan-step"
const isLeafMessage = (child: PlanChild): child is LeafMessage => child.type === "text"

const PlanLeafInline = ({
  message,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
}: {
  message: LeafMessage
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}) => {
  const content = displayContent(message)
  if (!content) return null
  if (message.role === "user") {
    return (
      <div className="flex w-full items-end justify-end">
        <div className="flex flex-col items-start rounded-2xl bg-brand-200 px-3 py-1.5 shadow-sm max-w-[90%]">
          <div className="prose prose-sm text-body font-body text-default-font [&>*]:mb-0 [&_a]:no-underline [&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-sm [&_h4]:!text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold">
            <MessageContent
              content={content}
              files={files}
              projectId={projectId}
              currentFile={currentFile}
              currentFileContent={currentFileContent}
              navigate={navigate}
            />
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex w-full items-start mt-1">
      <div className="flex flex-col items-start rounded-2xl bg-neutral-100 px-3 py-1.5 max-w-[90%]">
        <div className="prose prose-sm text-body font-body text-default-font [&>*]:mb-0 [&_a]:no-underline [&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-sm [&_h4]:!text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold">
          <MessageContent
            content={content}
            files={files}
            projectId={projectId}
            currentFile={currentFile}
            currentFileContent={currentFileContent}
            navigate={navigate}
          />
        </div>
      </div>
    </div>
  )
}

interface PlanChildRendererProps {
  child: PlanChild
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

const PlanChildRenderer = ({
  child,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
}: PlanChildRendererProps) => {
  if (isPlanStep(child))
    return (
      <PlanStepRow
        step={child}
        files={files}
        projectId={projectId}
        currentFile={currentFile}
        currentFileContent={currentFileContent}
        navigate={navigate}
      />
    )
  if (isLeafMessage(child))
    return (
      <PlanLeafInline
        message={child}
        files={files}
        projectId={projectId}
        currentFile={currentFile}
        currentFileContent={currentFileContent}
        navigate={navigate}
      />
    )
  return null
}

interface PlanHeaderRendererProps {
  header: PlanHeader
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

const PlanHeaderRenderer = ({
  header,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
}: PlanHeaderRendererProps) => (
  <div className="flex w-full flex-col items-start gap-1 py-1">
    <div className="prose prose-sm [&>*]:mb-0 [&_a]:no-underline text-body-bold font-body-bold text-default-font">
      <MessageContent
        content={header.task}
        files={files}
        projectId={projectId}
        currentFile={currentFile}
        currentFileContent={currentFileContent}
        navigate={navigate}
      />
    </div>
  </div>
)

const PlanItemRenderer = ({
  item,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
}: {
  item: PlanItem
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}) => (
  <div className={`flex w-full flex-col items-start${item.dimmed ? " opacity-50" : ""}`}>
    <PlanChildRenderer
      child={item.child}
      files={files}
      projectId={projectId}
      currentFile={currentFile}
      currentFileContent={currentFileContent}
      navigate={navigate}
    />
  </div>
)

type PlanMessage = PlanHeader | PlanItem

interface PlanSegment {
  type: "plan-segment"
  items: PlanMessage[]
}
interface CollapsedSteps {
  type: "collapsed-steps"
  count: number
}
type RenderSegment = LeafMessage | AskMessage | PlanSegment
type FinalSegment = RenderSegment | CollapsedSteps

interface KeyedSegment {
  key: string
  segment: FinalSegment
}

const isPlanRelated = (m: GroupedMessage): m is PlanMessage =>
  m.type === "plan-header" || m.type === "plan-item"

const isPlanSegment = (s: FinalSegment): s is PlanSegment => s.type === "plan-segment"

const isAskSegment = (s: FinalSegment): s is AskMessage => s.type === "ask"

const isCollapsedSteps = (s: FinalSegment): s is CollapsedSteps => s.type === "collapsed-steps"

const toKeyedSegments = (entries: KeyedMessage[]): KeyedSegment[] =>
  entries.reduce<KeyedSegment[]>((acc, { key, message }) => {
    if (!isPlanRelated(message)) {
      acc.push({ key, segment: message })
      return acc
    }
    const prev = acc[acc.length - 1]
    if (prev && isPlanSegment(prev.segment)) {
      ;(prev.segment as PlanSegment).items.push(message)
      return acc
    }
    acc.push({ key, segment: { type: "plan-segment", items: [message] } })
    return acc
  }, [])

const countPlanSteps = (items: PlanMessage[]): number =>
  items.filter((item) => item.type === "plan-item" && isPlanStep(item.child)).length

const findLastAskIndex = (segments: KeyedSegment[]): number => {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (isAskSegment(segments[i].segment)) return i
  }
  return -1
}

const collapseAfterPendingAsk = (segments: KeyedSegment[], waiting: boolean): KeyedSegment[] => {
  if (!waiting) return segments
  const lastAskIdx = findLastAskIndex(segments)
  if (lastAskIdx === -1) return segments
  const after = segments.slice(lastAskIdx + 1)
  const count = after.reduce(
    (sum: number, { segment: s }) => (isPlanSegment(s) ? sum + countPlanSteps(s.items) : sum),
    0
  )
  if (count === 0) return segments
  return [
    ...segments.slice(0, lastAskIdx + 1),
    { key: "collapsed", segment: { type: "collapsed-steps", count } },
  ]
}

interface PlanSegmentItemRendererProps {
  item: PlanMessage
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

const PlanSegmentItemRenderer = ({
  item,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
}: PlanSegmentItemRendererProps) => {
  switch (item.type) {
    case "plan-header":
      return (
        <PlanHeaderRenderer
          header={item}
          files={files}
          projectId={projectId}
          currentFile={currentFile}
          currentFileContent={currentFileContent}
          navigate={navigate}
        />
      )
    case "plan-item":
      return (
        <PlanItemRenderer
          item={item}
          files={files}
          projectId={projectId}
          currentFile={currentFile}
          currentFileContent={currentFileContent}
          navigate={navigate}
        />
      )
    default:
      return exhaustive(item)
  }
}

const CollapsedStepsIndicator = ({ count }: { count: number }) => (
  <span className="text-caption font-caption text-subtext-color">
    Waiting for your input — {count} step{count !== 1 ? "s" : ""} remaining
  </span>
)

const PlanContinuePrompt = ({ onContinue }: { onContinue: () => void }) => (
  <div className="flex w-full flex-col gap-1.5 max-w-[95%]">
    <OptionCard selected={false} dimmed={false} onClick={onContinue}>
      Continue to next step
    </OptionCard>
  </div>
)

const isPendingPlanStep = (item: PlanMessage): boolean =>
  item.type === "plan-item" && isPlanStep(item.child) && item.child.status === "pending"

const hasInlineLeaf = (items: PlanMessage[]): boolean =>
  items.some((item) => item.type === "plan-item" && isLeafMessage(item.child))

interface TrailingSplit {
  visible: PlanMessage[]
  pendingCount: number
}

const splitTrailingPending = (items: PlanMessage[], loading: boolean): TrailingSplit => {
  if (loading || !hasInlineLeaf(items)) return { visible: items, pendingCount: 0 }
  let splitIdx = items.length
  for (let i = items.length - 1; i >= 0; i--) {
    if (!isPendingPlanStep(items[i])) break
    splitIdx = i
  }
  return { visible: items.slice(0, splitIdx), pendingCount: items.length - splitIdx }
}

interface PlanSegmentRendererProps {
  items: PlanMessage[]
  loading: boolean
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

type SegmentRun = { type: "single"; item: PlanMessage } | { type: "nested"; items: PlanMessage[] }

const isAbortedPlan = (items: PlanMessage[]): boolean =>
  items.some((item) => item.type === "plan-header" && item.aborted)

const isNestedPlanItem = (item: PlanMessage): boolean =>
  item.type === "plan-item" && item.child.type === "plan-step" && item.child.nested

const groupIntoRuns = (items: PlanMessage[]): SegmentRun[] =>
  items.reduce<SegmentRun[]>((acc, item) => {
    if (!isNestedPlanItem(item)) {
      acc.push({ type: "single", item })
      return acc
    }
    const prev = acc[acc.length - 1]
    if (prev && prev.type === "nested") {
      prev.items.push(item)
      return acc
    }
    acc.push({ type: "nested", items: [item] })
    return acc
  }, [])

const PlanSegmentRenderer = ({
  items,
  loading,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
}: PlanSegmentRendererProps) => {
  const { visible, pendingCount } = splitTrailingPending(items, loading)
  const runs = groupIntoRuns(visible)
  return (
    <div className="flex w-full flex-col items-start gap-2 border-l-2 border-solid border-neutral-200 pl-3 pr-2 py-2 my-1">
      {runs.map((run, i) =>
        run.type === "single" ? (
          <PlanSegmentItemRenderer
            key={i}
            item={run.item}
            files={files}
            projectId={projectId}
            currentFile={currentFile}
            currentFileContent={currentFileContent}
            navigate={navigate}
          />
        ) : (
          <div
            key={i}
            className="flex w-full flex-col items-start gap-2 border-l-2 border-solid border-neutral-200 pl-3"
          >
            {run.items.map((item, j) => (
              <PlanSegmentItemRenderer
                key={j}
                item={item}
                files={files}
                projectId={projectId}
                currentFile={currentFile}
                currentFileContent={currentFileContent}
                navigate={navigate}
              />
            ))}
          </div>
        )
      )}
      {isAbortedPlan(items) ? (
        <AbortBox />
      ) : (
        pendingCount > 0 && <CollapsedStepsIndicator count={pendingCount} />
      )}
    </div>
  )
}

interface TickLabelProps {
  labels: string[]
}

const TickLabel = ({ labels }: TickLabelProps) => {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (index >= labels.length - 1) return
    const id = setTimeout(() => setIndex((i) => i + 1), LABEL_ADVANCE_MS)
    return () => clearTimeout(id)
  }, [index, labels.length])
  return (
    <div className="flex w-full items-start">
      <div className="flex items-center gap-2 rounded-2xl bg-neutral-100 px-4 py-2">
        <Loader2 className="text-body text-brand-600 flex-none animate-spin" />
        <span className="text-body font-body text-subtext-color">
          {labels[Math.min(index, labels.length - 1)]}
        </span>
      </div>
    </div>
  )
}

const findLastWriteEntry = (entries: HistoryEntry[]): HistoryEntry | null =>
  entries.length > 0 ? entries[entries.length - 1] : null

const isFileOperation = (entry: HistoryEntry): boolean => entry.entityKind === "file"

const formatLastWriteLabel = (entry: HistoryEntry, currentFile: string | null): string => {
  const { verbLabel, subtitle } = presentEntry(entry)
  if (isFileOperation(entry)) return `${verbLabel}: ${subtitle}`
  const isCurrentFile = entry.path === currentFile
  return isCurrentFile ? `${verbLabel} in current file` : `${verbLabel} in ${subtitle}`
}

interface LastWriteBarProps {
  entry: HistoryEntry
  currentFile: string | null
  onClick: () => void
}

const LastWriteBar = ({ entry, currentFile, onClick }: LastWriteBarProps) => {
  const { icon: Icon } = presentEntry(entry)
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 bg-brand-100 px-4 py-1.5 text-left hover:bg-brand-200 transition-colors"
    >
      <Icon className="text-brand-500 w-3.5 h-3.5 flex-none" />
      <span className="text-caption font-caption text-brand-700 truncate">
        {formatLastWriteLabel(entry, currentFile)}
      </span>
    </button>
  )
}

interface NabuChatSidebarProps {
  appReady: boolean
}

export const NabuChatSidebar = ({ appReady }: NabuChatSidebarProps) => {
  const navigate = useNavigate()
  const params = useParams<{ projectId: string }>()

  const getDeps = useCallback(() => {
    const project = params.projectId ? { id: params.projectId } : undefined
    return { project, navigate }
  }, [navigate, params.projectId])
  const { send, respond, run: runChat, cancel, loading, draft, history } = useChat()
  const mutationHistory = useMutationHistory()
  const lastEntry = useMemo(() => findLastWriteEntry(mutationHistory), [mutationHistory])
  const { files, currentFile } = useFiles()
  const currentFileContent = currentFile ? (files[currentFile] ?? null) : null

  const derived = useMemo(() => derive(history, files), [history, files])

  const isStreamingText = draft?.type === "text" && preprocessStreaming(draft.content) !== null
  const keyedMessages = useMemo(() => toGroupedMessages(history, derived), [history, derived])
  const rawSegments = useMemo(() => toKeyedSegments(keyedMessages), [keyedMessages])
  const waitingForInput = useMemo(() => isWaitingForAsk(history), [history])
  const segments = useMemo(
    () => collapseAfterPendingAsk(rawSegments, waitingForInput),
    [rawSegments, waitingForInput]
  )

  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const didAutoSend = useRef(false)
  useEffect(() => {
    if (!appReady) return
    if (history.length === 0 && !didAutoSend.current) {
      didAutoSend.current = true
      pushBlocks([
        ...buildFileContextBlocks(files),
        { type: "user", content: pickGreeting() },
        { type: "system", content: autoGreetingDirective(new Date().toLocaleString()) },
      ])
      runChat(getDeps())
    }
  }, [appReady, history.length, runChat, getDeps, files])

  const inPlan = hasActivePlan(derived.plans)
  const isWaitingForContinue =
    inPlan && !loading && !waitingForInput && isCurrentStepCheckpoint(derived.plans)
  const buttonMode = deriveChatButtonMode(loading, waitingForInput, inPlan)

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return
    if (waitingForInput || isWaitingForContinue) {
      respond(inputValue.trim())
      setInputValue("")
      return
    }
    if (loading) return
    send(inputValue.trim(), getDeps())
    setInputValue("")
  }, [loading, waitingForInput, isWaitingForContinue, inputValue, send, respond, getDeps])

  const handleSkipAsk = useCallback(() => {
    respond("Let's do something else for now")
  }, [respond])

  const handleCancelPlan = useCallback(() => {
    send("Let's do something else for now", getDeps())
  }, [send, getDeps])

  const handleContinue = useCallback(() => {
    respond("Continue to next step")
  }, [respond])

  const markTyping = useCallback(() => {
    setIsTyping(true)
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => setIsTyping(false), 300)
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      markTyping()
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend, markTyping]
  )

  const navigateToFile = useCallback(
    (path: string) => {
      if (!params.projectId) return
      navigate(`/project/${params.projectId}/file/${encodeURIComponent(path)}`)
    },
    [navigate, params.projectId]
  )

  const spinnerLabels = loading && !isStreamingText ? getSpinnerLabels(history, draft) : null

  return (
    <div className="flex w-full grow flex-col rounded-xl border border-solid border-panel-border bg-white overflow-hidden">
      <AutoScroll className="flex w-full grow shrink-0 basis-0 flex-col items-start gap-2 px-4 py-4 overflow-auto">
        {keyedMessages.length === 0 && !loading && (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-body font-body text-subtext-color">
              How can I help you today?
            </span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {segments.map(({ key, segment }, index) => {
            const isLast = index === segments.length - 1
            return (
              <AnimatedListItem key={key} layout={isTyping ? false : "position"}>
                {isPlanSegment(segment) ? (
                  <PlanSegmentRenderer
                    items={segment.items}
                    loading={loading}
                    files={files}
                    projectId={params.projectId ?? null}
                    currentFile={currentFile}
                    currentFileContent={currentFileContent}
                    navigate={navigate}
                  />
                ) : isAskSegment(segment) ? (
                  <AskRenderer
                    message={segment}
                    files={files}
                    projectId={params.projectId ?? null}
                    currentFile={currentFile}
                    currentFileContent={currentFileContent}
                    navigate={navigate}
                    onSelect={respond}
                    isLast={isLast}
                  />
                ) : isCollapsedSteps(segment) ? (
                  <CollapsedStepsIndicator count={segment.count} />
                ) : (
                  <LeafRenderer
                    message={segment}
                    files={files}
                    projectId={params.projectId ?? null}
                    currentFile={currentFile}
                    currentFileContent={currentFileContent}
                    navigate={navigate}
                    isLast={isLast}
                  />
                )}
              </AnimatedListItem>
            )
          })}
        </AnimatePresence>
        {isWaitingForContinue && <PlanContinuePrompt onContinue={handleContinue} />}
        {!waitingForInput && spinnerLabels && (
          <TickLabel key={spinnerLabels.join()} labels={spinnerLabels} />
        )}
      </AutoScroll>

      {lastEntry && (
        <LastWriteBar
          entry={lastEntry}
          currentFile={currentFile}
          onClick={() => navigateToFile(lastEntry.path)}
        />
      )}

      <div
        className={`flex w-full items-end gap-2 border-t border-solid border-neutral-border px-4 py-3 ${buttonMode === "cancel" ? "bg-neutral-50" : ""}`}
      >
        <TextFieldUnstyled className="grow min-h-5">
          <TextFieldUnstyled.Textarea
            ref={inputRef}
            placeholder={
              waitingForInput || isWaitingForContinue
                ? "Or type your own answer..."
                : "Message Nabu..."
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </TextFieldUnstyled>
        <ChatSendButton
          mode={buttonMode}
          disabled={buttonMode === "send" && !inputValue.trim()}
          onSend={handleSend}
          onSkipAsk={handleSkipAsk}
          onCancel={cancel}
          onCancelPlan={handleCancelPlan}
        />
      </div>
    </div>
  )
}
