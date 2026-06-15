"use client"

import {
  useState,
  useCallback,
  useEffect,
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
import { AutoScroll } from "~/ui/components/AutoScroll"
import { AnimatedListItem } from "~/ui/components/AnimatedListItem"
import { useChat } from "~/ui/hooks/useChat"
import { derive, hasActivePlan, isCurrentStepCheckpoint, lastPlan } from "~/lib/agent/derived"
import { pushBlocks } from "~/lib/agent/client/store"
import {
  toGroupedMessages,
  weaveEditGroups,
  type GroupedMessage,
  type KeyedMessage,
  type LeafMessage,
  type PlanStartMessage,
  type PlanStepMessage,
  type EditGroupMessage,
  type StepStatus,
} from "./group"
import { EditGroupCard } from "./EditGroupCard"
import type { AskMessage } from "./messages"
import { isWaitingForAsk } from "./messages"
import { getSpinnerLabels, LABEL_ADVANCE_MS } from "./spinnerLabel"
import { useFiles } from "~/ui/hooks/useFiles"
import { preprocessStreaming } from "~/lib/markdown/sanitize/partial"
import { AbortBox } from "~/ui/components/ai/StepsBlock"
import { createEntityLinkComponents } from "~/ui/components/markdown/createEntityLinkComponents"
import { summarizeMiddle } from "~/lib/text/summarize"
import type { EntityKind } from "~/lib/markdown/linkify/types"
import { linkifyTags } from "~/lib/markdown/linkify/tags"
import { fixMarkdownUrls } from "~/lib/markdown/sanitize/fix-urls"
import {
  findTagDefinitionByLabel,
  getTagDisplay,
} from "~/domain/data-blocks/settings/tags/selectors"
import { resolveEntityName } from "~/lib/files/selectors"
import { truncateLabel } from "~/lib/mutation-history/presentation"
import { useMutationHistory } from "~/lib/mutation-history/useMutationHistory"
import { prepareEntityMarkdown } from "~/lib/markdown/prepare"
import { InlineMarkdown } from "~/ui/components/InlineMarkdown"
import { autoGreetingDirective } from "~/lib/agent/actions/actions"
import { buildFileContextBlocks } from "~/lib/agent/context-blocks"
import { pickGreeting } from "./greetings"
import { exhaustive } from "~/lib/utils/exhaustive"
import { ChatSendButton, deriveChatButtonMode } from "./ChatSendButton"
import { TimelineCard, Connector, type TimelineMarker } from "./TimelineCard"

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
  return def ? { id: def.id, display: getTagDisplay(def) } : null
}

const remarkPlugins = [remarkGfm]

const summarizeAnnotationLabel = (label: string, kind: EntityKind): string =>
  kind === "annotation" ? summarizeMiddle(label) : label

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
        ...createEntityLinkComponents({
          files,
          projectId,
          navigate,
          transformLabel: summarizeAnnotationLabel,
        }),
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

const proseClass =
  "prose prose-sm text-body font-body text-default-font [&>*]:mb-2 [&>*:last-child]:mb-0 [&_a]:no-underline [&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-sm [&_h4]:!text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold"

const CardBody = ({ children }: { children: ReactNode }) => (
  <div className={proseClass}>{children}</div>
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

const stepKindClass: Record<StepStatus, string> = {
  completed: "text-[11px] font-bold uppercase tracking-[0.08em] text-brand-700",
  active: "text-[11px] font-bold uppercase tracking-[0.08em] text-brand-700",
  pending: "text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400",
  cancelled: "text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400",
}

const stepMarker: Record<StepStatus, TimelineMarker> = {
  completed: "step-done",
  active: "step-active",
  pending: "step-pending",
  cancelled: "step-cancelled",
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
  prev.message.timestamp === next.message.timestamp &&
  prev.message.firstInAnswerRun === next.message.firstInAnswerRun &&
  prev.message.inPlan === next.message.inPlan &&
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
    const isUser = message.role === "user"
    const isContinuation = !isUser && message.firstInAnswerRun === false
    const isPlanLeaf = message.inPlan === true
    const hideCaption = isContinuation || isPlanLeaf
    return (
      <TimelineCard
        kind={hideCaption ? null : isUser ? "QUESTION" : "ANSWER"}
        marker={isUser ? "ask" : "respond"}
        scrollOnMount={isUser && isLast}
        timestamp={message.timestamp}
      >
        <CardBody>
          <MessageContent
            content={content}
            files={files}
            projectId={projectId}
            currentFile={currentFile}
            currentFileContent={currentFileContent}
            navigate={navigate}
          />
        </CardBody>
      </TimelineCard>
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
  prev.message.timestamp === next.message.timestamp &&
  prev.message.answerTimestamp === next.message.answerTimestamp &&
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
    <div className="flex w-full flex-col items-stretch gap-2">
      <TimelineCard kind="QUESTION" marker="respond" timestamp={message.timestamp}>
        <CardBody>
          <MessageContent
            content={message.question}
            files={files}
            projectId={projectId}
            currentFile={currentFile}
            currentFileContent={currentFileContent}
            navigate={navigate}
          />
        </CardBody>
        {hasOptions(message) && (
          <>
            <hr className="my-3 border-t border-neutral-100" />
            <div className="flex w-full flex-col gap-1.5">
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
          </>
        )}
      </TimelineCard>
      {isTypedAnswer(message) && (
        <>
          <Connector />
          <TimelineCard
            kind="ANSWER"
            marker="ask"
            scrollOnMount={isLast}
            timestamp={message.answerTimestamp}
          >
            <CardBody>
              <MessageContent
                content={message.selected ?? ""}
                files={files}
                projectId={projectId}
                currentFile={currentFile}
                currentFileContent={currentFileContent}
                navigate={navigate}
              />
            </CardBody>
          </TimelineCard>
        </>
      )}
    </div>
  ),
  askPropsEqual
)

interface PlanStartCardProps {
  message: PlanStartMessage
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

const planStartPropsEqual = (prev: PlanStartCardProps, next: PlanStartCardProps): boolean =>
  prev.message.task === next.message.task &&
  prev.message.completed === next.message.completed &&
  prev.message.aborted === next.message.aborted &&
  prev.message.timestamp === next.message.timestamp &&
  prev.files === next.files &&
  prev.projectId === next.projectId &&
  prev.currentFile === next.currentFile &&
  prev.currentFileContent === next.currentFileContent &&
  prev.navigate === next.navigate

const PlanStartCard = memo(
  ({
    message,
    files,
    projectId,
    currentFile,
    currentFileContent,
    navigate,
  }: PlanStartCardProps) => (
    <TimelineCard kind="PLAN" marker="plan" timestamp={message.timestamp}>
      <CardBody>
        <MessageContent
          content={message.task}
          files={files}
          projectId={projectId}
          currentFile={currentFile}
          currentFileContent={currentFileContent}
          navigate={navigate}
        />
      </CardBody>
    </TimelineCard>
  ),
  planStartPropsEqual
)

interface PlanStepCardProps {
  message: PlanStepMessage
}

const planStepPropsEqual = (prev: PlanStepCardProps, next: PlanStepCardProps): boolean =>
  prev.message.description === next.message.description &&
  prev.message.status === next.message.status &&
  prev.message.checkpoint === next.message.checkpoint &&
  prev.message.nested === next.message.nested &&
  prev.message.timestamp === next.message.timestamp

const PlanStepCard = memo(({ message }: PlanStepCardProps) => {
  const marker: TimelineMarker = message.checkpoint ? "step-checkpoint" : stepMarker[message.status]
  const Icon = message.checkpoint ? MessageSquare : stepIconComponent[message.status]
  const glyph = <Icon className={`text-body ${stepIconColor[message.status]} flex-none`} />
  return (
    <div className={message.nested ? "pl-4" : ""}>
      <TimelineCard
        kind={message.description.toUpperCase()}
        marker={marker}
        timestamp={message.timestamp}
        glyph={glyph}
        kindClassName={stepKindClass[message.status]}
      />
    </div>
  )
}, planStepPropsEqual)

interface CollapsedSteps {
  type: "collapsed-steps"
  count: number
}

interface ContinuePromptSegment {
  type: "continue-prompt"
}

type FinalSegment = GroupedMessage | CollapsedSteps | ContinuePromptSegment

interface KeyedSegment {
  key: string
  segment: FinalSegment
}

const isAskSegment = (s: FinalSegment): s is AskMessage => s.type === "ask"

const isPlanStartSegment = (s: FinalSegment): s is PlanStartMessage => s.type === "plan-start"

const isPlanStepSegment = (s: FinalSegment): s is PlanStepMessage => s.type === "plan-step"

const isCollapsedSteps = (s: FinalSegment): s is CollapsedSteps => s.type === "collapsed-steps"

const isContinuePromptSegment = (s: FinalSegment): s is ContinuePromptSegment =>
  s.type === "continue-prompt"

const isLeafSegment = (s: FinalSegment): s is LeafMessage => s.type === "text"

const isEditGroupSegment = (s: FinalSegment): s is EditGroupMessage => s.type === "edit-group"

const toKeyedSegments = (entries: KeyedMessage[]): KeyedSegment[] =>
  entries.map(({ key, message }) => ({ key, segment: message }))

const countStepCards = (segments: KeyedSegment[]): number =>
  segments.filter(({ segment }) => isPlanStepSegment(segment)).length

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
  const count = countStepCards(after)
  if (count === 0) return segments
  return [
    ...segments.slice(0, lastAskIdx + 1),
    { key: "collapsed", segment: { type: "collapsed-steps", count } },
  ]
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

interface TickLabelProps {
  labels: string[]
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate?: (url: string) => void
}

const TickInlineP = ({ children }: { children?: ReactNode }) => <span>{children}</span>

const TickLabel = ({
  labels,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
}: TickLabelProps) => {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (index >= labels.length - 1) return
    const id = setTimeout(() => setIndex((i) => i + 1), LABEL_ADVANCE_MS)
    return () => clearTimeout(id)
  }, [index, labels.length])
  const components = useMemo(
    () => ({
      ...createEntityLinkComponents({
        files,
        projectId,
        navigate,
        transformLabel: summarizeAnnotationLabel,
      }),
      p: TickInlineP,
    }),
    [files, projectId, navigate]
  )
  const label = labels[Math.min(index, labels.length - 1)]
  const prepared = fixMarkdownUrls(
    linkifyTags(
      prepareEntityMarkdown(
        label,
        (id) => resolveAndTruncateName(files, id),
        currentFile,
        currentFileContent
      ),
      (l) => resolveTagForLinkify(files, l)
    )
  )
  return (
    <TimelineCard kind={null} marker="respond">
      <div className="flex items-center gap-2">
        <Loader2 className="text-body text-brand-600 flex-none animate-spin" />
        <span className="text-body font-body text-subtext-color">
          <Markdown components={components} urlTransform={allowFileProtocol}>
            {prepared}
          </Markdown>
        </span>
      </div>
    </TimelineCard>
  )
}

interface SegmentRendererProps {
  segment: FinalSegment
  files: Record<string, string>
  projectId: string | null
  currentFile: string | null
  currentFileContent: string | null
  navigate: (url: string) => void
  onSelect: (option: string) => void
  onSelectFile: (path: string) => void
  onContinue: () => void
  isLast: boolean
}

const SegmentRenderer = ({
  segment,
  files,
  projectId,
  currentFile,
  currentFileContent,
  navigate,
  onSelect,
  onSelectFile,
  onContinue,
  isLast,
}: SegmentRendererProps) => {
  if (isLeafSegment(segment))
    return (
      <LeafRenderer
        message={segment}
        files={files}
        projectId={projectId}
        currentFile={currentFile}
        currentFileContent={currentFileContent}
        navigate={navigate}
        isLast={isLast}
      />
    )
  if (isAskSegment(segment))
    return (
      <AskRenderer
        message={segment}
        files={files}
        projectId={projectId}
        currentFile={currentFile}
        currentFileContent={currentFileContent}
        navigate={navigate}
        onSelect={onSelect}
        isLast={isLast}
      />
    )
  if (isPlanStartSegment(segment))
    return (
      <PlanStartCard
        message={segment}
        files={files}
        projectId={projectId}
        currentFile={currentFile}
        currentFileContent={currentFileContent}
        navigate={navigate}
      />
    )
  if (isPlanStepSegment(segment)) return <PlanStepCard message={segment} />
  if (isEditGroupSegment(segment))
    return <EditGroupCard message={segment} onSelectFile={onSelectFile} />
  if (isCollapsedSteps(segment))
    return (
      <div className="pl-[30px] w-full">
        <CollapsedStepsIndicator count={segment.count} />
      </div>
    )
  if (isContinuePromptSegment(segment))
    return (
      <div className="pl-[30px] w-full">
        <PlanContinuePrompt onContinue={onContinue} />
      </div>
    )
  return exhaustive(segment)
}

const findActiveCheckpointIndex = (segments: KeyedSegment[]): number =>
  segments.findIndex(
    (s) => isPlanStepSegment(s.segment) && s.segment.status === "active" && s.segment.checkpoint
  )

const findStepBoundaryAfter = (segments: KeyedSegment[], start: number): number => {
  for (let i = start; i < segments.length; i++) {
    const t = segments[i].segment.type
    if (t === "plan-step" || t === "plan-start") return i
  }
  return segments.length
}

const injectContinuePrompt = (segments: KeyedSegment[], waiting: boolean): KeyedSegment[] => {
  if (!waiting) return segments
  const checkpointIdx = findActiveCheckpointIndex(segments)
  if (checkpointIdx === -1) return segments
  const insertAt = findStepBoundaryAfter(segments, checkpointIdx + 1)
  const prompt: KeyedSegment = {
    key: "continue-prompt",
    segment: { type: "continue-prompt" },
  }
  return [...segments.slice(0, insertAt), prompt, ...segments.slice(insertAt)]
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
  const { files, currentFile } = useFiles()
  const currentFileContent = currentFile ? (files[currentFile] ?? null) : null

  const derived = useMemo(() => derive(history, files), [history, files])

  const isStreamingText = draft?.type === "text" && preprocessStreaming(draft.content) !== null
  const keyedMessages = useMemo(() => toGroupedMessages(history, derived), [history, derived])
  const wovenMessages = useMemo(
    () => weaveEditGroups(keyedMessages, mutationHistory),
    [keyedMessages, mutationHistory]
  )
  const rawSegments = useMemo(() => toKeyedSegments(wovenMessages), [wovenMessages])
  const waitingForInput = useMemo(() => isWaitingForAsk(history), [history])
  const collapsedSegments = useMemo(
    () => collapseAfterPendingAsk(rawSegments, waitingForInput),
    [rawSegments, waitingForInput]
  )

  const [inputValue, setInputValue] = useState("")
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

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const navigateToFile = useCallback(
    (path: string) => {
      if (!params.projectId) return
      navigate(`/project/${params.projectId}/file/${encodeURIComponent(path)}`)
    },
    [navigate, params.projectId]
  )

  const spinnerLabels = loading && !isStreamingText ? getSpinnerLabels(history, draft) : null
  const activePlan = lastPlan(derived.plans)
  const showAbortBox = activePlan?.aborted === true
  const segments = useMemo(
    () => injectContinuePrompt(collapsedSegments, isWaitingForContinue),
    [collapsedSegments, isWaitingForContinue]
  )

  return (
    <div className="flex w-full grow flex-col overflow-hidden">
      <AutoScroll className="relative flex w-full grow shrink-0 basis-0 flex-col items-start pr-4 pt-3 overflow-y-auto">
        {keyedMessages.length === 0 && !loading && (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-body font-body text-subtext-color">
              How can I help you today?
            </span>
          </div>
        )}
        {segments.flatMap(({ key, segment }, index) => {
          const isLast = index === segments.length - 1
          const renderSegment = (
            <SegmentRenderer
              segment={segment}
              files={files}
              projectId={params.projectId ?? null}
              currentFile={currentFile}
              currentFileContent={currentFileContent}
              navigate={navigate}
              onSelect={respond}
              onSelectFile={navigateToFile}
              onContinue={handleContinue}
              isLast={isLast}
            />
          )
          const items: ReactNode[] = []
          if (index > 0) items.push(<Connector key={`c-${key}`} />)
          items.push(
            <AnimatedListItem key={key} layout={false}>
              {renderSegment}
            </AnimatedListItem>
          )
          return items
        })}
        {showAbortBox && (
          <>
            {segments.length > 0 && <Connector />}
            <div className="pl-[30px] w-full">
              <AbortBox />
            </div>
          </>
        )}
        {!waitingForInput && spinnerLabels && (
          <>
            <Connector />
            <TickLabel
              key={spinnerLabels.join()}
              labels={spinnerLabels}
              files={files}
              projectId={params.projectId ?? null}
              currentFile={currentFile}
              currentFileContent={currentFileContent}
              navigate={navigateToFile}
            />
          </>
        )}
      </AutoScroll>

      <div className="px-3 pb-3 pt-4">
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault()
              inputRef.current?.focus()
            }
          }}
          className={`flex w-full items-end gap-2 rounded-2xl border border-solid border-neutral-200 px-4 py-3 cursor-text ${buttonMode === "cancel" ? "bg-neutral-50" : "bg-white"}`}
        >
          <TextFieldUnstyled
            className="grow min-h-5"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                e.preventDefault()
                inputRef.current?.focus()
              }
            }}
          >
            <TextFieldUnstyled.Textarea
              ref={inputRef}
              name="chat-message"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              data-form-type="other"
              placeholder={
                waitingForInput || isWaitingForContinue
                  ? "Or type your own answer..."
                  : "Ask a follow-up..."
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
    </div>
  )
}
