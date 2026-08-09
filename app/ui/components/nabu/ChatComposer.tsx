"use client"

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
  type MouseEvent,
} from "react"
import { TextFieldUnstyled } from "~/ui/components/TextFieldUnstyled"
import { ChatSendButton, type ChatButtonMode } from "./ChatSendButton"

export interface ChatComposerProps {
  mode: ChatButtonMode
  awaitingAnswer: boolean
  onSend: (text: string) => void
  onSkipAsk: () => void
  onCancel: () => void
  onCancelPlan: () => void
}

export const ChatComposer = ({
  mode,
  awaitingAnswer,
  onSend,
  onSkipAsk,
  onCancel,
  onCancelPlan,
}: ChatComposerProps) => {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const trimmed = text.trim()

  const submit = useCallback(() => {
    const value = text.trim()
    if (mode === "cancel" || !value) return
    onSend(value)
    setText("")
  }, [mode, text, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
    },
    [submit]
  )

  const focusOnBackgroundClick = (e: MouseEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) {
      e.preventDefault()
      inputRef.current?.focus()
    }
  }

  return (
    <div className="px-3 pb-3 pt-4">
      <div
        onMouseDown={focusOnBackgroundClick}
        className={`flex w-full items-end gap-2 rounded-2xl border border-solid border-neutral-200 px-4 py-3 cursor-text ${mode === "cancel" ? "bg-neutral-50" : "bg-white"}`}
      >
        <TextFieldUnstyled className="grow min-h-5" onMouseDown={focusOnBackgroundClick}>
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
            placeholder={awaitingAnswer ? "Or type your own answer..." : "Ask a follow-up..."}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </TextFieldUnstyled>
        <ChatSendButton
          mode={mode}
          disabled={mode === "send" && !trimmed}
          onSend={submit}
          onSkipAsk={onSkipAsk}
          onCancel={onCancel}
          onCancelPlan={onCancelPlan}
        />
      </div>
    </div>
  )
}
