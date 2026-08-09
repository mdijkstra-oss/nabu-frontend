"use client"

import { useCallback, useEffect, useRef, useMemo } from "react"
import { useNavigate, useParams } from "react-router"
import { useChat } from "~/ui/hooks/useChat"
import { useFiles } from "~/ui/hooks/useFiles"
import { derive, hasActivePlan, isCurrentStepCheckpoint, lastPlan } from "~/lib/agent/derived"
import { pushBlocks } from "~/lib/agent/client/store"
import { autoGreetingDirective } from "~/lib/agent/actions/actions"
import { buildFileContextBlocks } from "~/lib/agent/context-blocks"
import { preprocessStreaming } from "~/lib/markdown/sanitize/partial"
import { useMutationHistory } from "~/lib/mutation-history/useMutationHistory"
import { toGroupedMessages, weaveEditGroups } from "./group"
import { toKeyedSegments, injectContinuePrompt, collapsePendingTail } from "./collapse"
import { isWaitingForAsk } from "./messages"
import { getSpinnerLabels } from "./spinnerLabel"
import { pickGreeting } from "./greetings"
import { deriveChatButtonMode } from "./ChatSendButton"
import { ChatTimeline } from "./ChatTimeline"
import { ChatComposer } from "./ChatComposer"
import type { ChatEntityContext } from "./MessageContent"

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

  const context = useMemo<ChatEntityContext>(
    () => ({
      files,
      projectId: params.projectId ?? null,
      currentFile,
      currentFileContent,
      navigate,
    }),
    [files, params.projectId, currentFile, currentFileContent, navigate]
  )

  const derived = useMemo(() => derive(history, files), [history, files])

  const isStreamingText = draft?.type === "text" && preprocessStreaming(draft.content) !== null
  const keyedMessages = useMemo(() => toGroupedMessages(history, derived), [history, derived])
  const wovenMessages = useMemo(
    () => weaveEditGroups(keyedMessages, mutationHistory),
    [keyedMessages, mutationHistory]
  )
  const rawSegments = useMemo(() => toKeyedSegments(wovenMessages), [wovenMessages])
  const waitingForInput = useMemo(() => isWaitingForAsk(history), [history])

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

  const handleSend = useCallback(
    (text: string) => {
      if (waitingForInput || isWaitingForContinue) {
        respond(text)
        return
      }
      if (loading) return
      send(text, getDeps())
    },
    [loading, waitingForInput, isWaitingForContinue, send, respond, getDeps]
  )

  const handleSkipAsk = useCallback(() => {
    respond("Let's do something else for now")
  }, [respond])

  const handleCancelPlan = useCallback(() => {
    send("Let's do something else for now", getDeps())
  }, [send, getDeps])

  const handleContinue = useCallback(() => {
    respond("Continue to next step")
  }, [respond])

  const navigateToFile = useCallback(
    (path: string) => {
      if (!params.projectId) return
      navigate(`/project/${params.projectId}/file/${encodeURIComponent(path)}`)
    },
    [navigate, params.projectId]
  )

  const spinnerLabels =
    loading && !isStreamingText && !waitingForInput ? getSpinnerLabels(history, draft) : null
  const activePlan = lastPlan(derived.plans)
  const showAbortBox = activePlan?.aborted === true
  const segments = useMemo(
    () => collapsePendingTail(injectContinuePrompt(rawSegments, isWaitingForContinue)),
    [rawSegments, isWaitingForContinue]
  )

  return (
    <div className="flex w-full grow flex-col overflow-hidden">
      <ChatTimeline
        segments={segments}
        context={context}
        onSelect={respond}
        onSelectFile={navigateToFile}
        onContinue={handleContinue}
        spinnerLabels={spinnerLabels}
        showAbortBox={showAbortBox}
        showPlaceholder={!loading}
      />
      <ChatComposer
        mode={buttonMode}
        awaitingAnswer={waitingForInput || isWaitingForContinue}
        onSend={handleSend}
        onSkipAsk={handleSkipAsk}
        onCancel={cancel}
        onCancelPlan={handleCancelPlan}
      />
    </div>
  )
}
