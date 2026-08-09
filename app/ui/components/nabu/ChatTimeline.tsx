"use client"

import { useState, useEffect, useMemo, memo, type ReactNode } from "react"
import Markdown from "react-markdown"
import { Check, ChevronRight, Circle, Layers, Loader2, MessageSquare, X } from "lucide-react"
import { cn } from "~/ui/utils"
import { AutoScroll } from "~/ui/components/AutoScroll"
import { AnimatedListItem } from "~/ui/components/AnimatedListItem"
import { AbortBox } from "~/ui/components/ai/StepsBlock"
import { InlineMarkdown } from "~/ui/components/InlineMarkdown"
import { preprocessStreaming } from "~/lib/markdown/sanitize/partial"
import { exhaustive } from "~/lib/utils/exhaustive"
import type { LeafMessage, PlanStartMessage, PlanStepMessage, StepStatus } from "./group"
import type { AskMessage } from "./messages"
import {
  type FinalSegment,
  type KeyedSegment,
  isAskSegment,
  isPlanStartSegment,
  isPlanStepSegment,
  isStepStackSegment,
  isContinuePromptSegment,
  isLeafSegment,
  isEditGroupSegment,
} from "./collapse"
import { LABEL_ADVANCE_MS } from "./spinnerLabel"
import { EditGroupCard } from "./EditGroupCard"
import { CollapsibleGroupCard, slateTone } from "./CollapsibleGroupCard"
import { TimelineCard, Connector, type TimelineMarker } from "./TimelineCard"
import {
  MessageContent,
  allowFileProtocol,
  createChatLinkComponents,
  prepareChatMarkdown,
  type ChatEntityContext,
} from "./MessageContent"

export interface SegmentRendererProps {
  segment: FinalSegment
  context: ChatEntityContext
  onSelect: (option: string) => void
  onSelectFile: (path: string) => void
  onContinue: () => void
  isLast: boolean
}

export const SegmentRenderer = ({
  segment,
  context,
  onSelect,
  onSelectFile,
  onContinue,
  isLast,
}: SegmentRendererProps) => {
  if (isLeafSegment(segment))
    return <LeafRenderer message={segment} context={context} isLast={isLast} />
  if (isAskSegment(segment))
    return <AskRenderer message={segment} context={context} onSelect={onSelect} isLast={isLast} />
  if (isPlanStartSegment(segment)) return <PlanStartCard message={segment} context={context} />
  if (isPlanStepSegment(segment)) return <PlanStepCard message={segment} />
  if (isEditGroupSegment(segment))
    return <EditGroupCard message={segment} onSelectFile={onSelectFile} />
  if (isStepStackSegment(segment)) return <CollapsibleStepStack steps={segment.steps} />
  if (isContinuePromptSegment(segment))
    return (
      <div className="pl-[30px] w-full">
        <PlanContinuePrompt onContinue={onContinue} />
      </div>
    )
  return exhaustive(segment)
}

export interface ChatTimelineProps {
  segments: KeyedSegment[]
  context: ChatEntityContext
  onSelect: (option: string) => void
  onSelectFile: (path: string) => void
  onContinue: () => void
  spinnerLabels: string[] | null
  showAbortBox: boolean
  showPlaceholder: boolean
}

export const ChatTimeline = ({
  segments,
  context,
  onSelect,
  onSelectFile,
  onContinue,
  spinnerLabels,
  showAbortBox,
  showPlaceholder,
}: ChatTimelineProps) => (
  <AutoScroll className="relative flex w-full grow shrink-0 basis-0 flex-col items-start pr-4 pt-3 overflow-y-auto">
    {segments.length === 0 && showPlaceholder && (
      <div className="flex h-full w-full items-center justify-center">
        <span className="text-body font-body text-subtext-color">How can I help you today?</span>
      </div>
    )}
    {segments.flatMap(({ key, segment }, index) => {
      const isLast = index === segments.length - 1
      const items: ReactNode[] = []
      if (index > 0) items.push(<Connector key={`c-${key}`} />)
      items.push(
        <AnimatedListItem key={key} layout={false}>
          <SegmentRenderer
            segment={segment}
            context={context}
            onSelect={onSelect}
            onSelectFile={onSelectFile}
            onContinue={onContinue}
            isLast={isLast}
          />
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
    {spinnerLabels && (
      <>
        <Connector />
        <TickLabel key={spinnerLabels.join()} labels={spinnerLabels} context={context} />
      </>
    )}
  </AutoScroll>
)

const proseClass =
  "prose prose-sm text-body font-body text-default-font [&>*]:mb-2 [&>*:last-child]:mb-0 [&_a]:no-underline [&_h1]:!text-sm [&_h2]:!text-sm [&_h3]:!text-sm [&_h4]:!text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold"

const CardBody = ({ children }: { children: ReactNode }) => (
  <div className={proseClass}>{children}</div>
)

const displayContent = (message: LeafMessage): string | null =>
  message.draft ? preprocessStreaming(message.content) : message.content

interface LeafRendererProps {
  message: LeafMessage
  context: ChatEntityContext
  isLast?: boolean
}

const LeafRenderer = memo(({ message, context, isLast }: LeafRendererProps) => {
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
        <MessageContent content={content} context={context} />
      </CardBody>
    </TimelineCard>
  )
})

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
  context: ChatEntityContext
  onSelect: (option: string) => void
  isLast?: boolean
}

const isTypedAnswer = (message: AskMessage): boolean =>
  message.selected !== null && !message.options.some((o) => o.label === message.selected)

const hasOptions = (message: AskMessage): boolean => message.options.length > 0

const AskRenderer = memo(({ message, context, onSelect, isLast }: AskRendererProps) => (
  <div className="flex w-full flex-col items-stretch gap-2">
    <TimelineCard kind="QUESTION" marker="respond" timestamp={message.timestamp}>
      <CardBody>
        <MessageContent content={message.question} context={context} />
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
                    files={context.files}
                    projectId={context.projectId}
                    currentFile={context.currentFile}
                    currentFileContent={context.currentFileContent}
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
            <MessageContent content={message.selected ?? ""} context={context} />
          </CardBody>
        </TimelineCard>
      </>
    )}
  </div>
))

interface PlanStartCardProps {
  message: PlanStartMessage
  context: ChatEntityContext
}

const PlanStartCard = memo(({ message, context }: PlanStartCardProps) => (
  <TimelineCard kind="PLAN" marker="plan" timestamp={message.timestamp}>
    <CardBody>
      <MessageContent content={message.task} context={context} />
    </CardBody>
  </TimelineCard>
))

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

const PlanStepCard = memo(({ message }: { message: PlanStepMessage }) => {
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
})

const upcomingKindClass = "text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"

const StepStackRow = ({ step }: { step: PlanStepMessage }) => (
  <div className={cn("flex items-center gap-2 px-3 py-1.5", step.nested && "pl-6")}>
    <Circle className="h-2 w-2 flex-none text-slate-400" />
    <span className="text-caption font-caption text-slate-700 truncate">{step.description}</span>
  </div>
)

const CollapsibleStepStack = ({ steps }: { steps: PlanStepMessage[] }) => (
  <TimelineCard kind="Upcoming" marker="step-pending" kindClassName={upcomingKindClass}>
    <CollapsibleGroupCard
      tone={slateTone}
      glyph={<Layers className="h-3.5 w-3.5" />}
      summary={`${steps.length} upcoming steps`}
    >
      {steps.map((step, i) => (
        <StepStackRow key={`stack-step-${i}`} step={step} />
      ))}
    </CollapsibleGroupCard>
  </TimelineCard>
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
  context: ChatEntityContext
}

const TickInlineP = ({ children }: { children?: ReactNode }) => <span>{children}</span>

const TickLabel = ({ labels, context }: TickLabelProps) => {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (index >= labels.length - 1) return
    const id = setTimeout(() => setIndex((i) => i + 1), LABEL_ADVANCE_MS)
    return () => clearTimeout(id)
  }, [index, labels.length])
  const components = useMemo(
    () => ({ ...createChatLinkComponents(context), p: TickInlineP }),
    [context]
  )
  const label = labels[Math.min(index, labels.length - 1)]
  return (
    <TimelineCard kind={null} marker="respond">
      <div className="flex items-center gap-2">
        <Loader2 className="text-body text-brand-600 flex-none animate-spin" />
        <span className="text-body font-body text-subtext-color">
          <Markdown components={components} urlTransform={allowFileProtocol}>
            {prepareChatMarkdown(label, context)}
          </Markdown>
        </span>
      </div>
    </TimelineCard>
  )
}
