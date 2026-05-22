import { Send, SkipForward, StopCircle, ListX } from "lucide-react"
import { IconButton } from "~/ui/components/IconButton"
import { TooltipWrap } from "~/ui/components/TooltipWrap"

export type ChatButtonMode = "send" | "skip-ask" | "cancel" | "cancel-plan"

export const deriveChatButtonMode = (
  loading: boolean,
  waitingForInput: boolean,
  inPlan: boolean
): ChatButtonMode => {
  if (waitingForInput) return "skip-ask"
  if (loading) return "cancel"
  if (inPlan) return "cancel-plan"
  return "send"
}

interface ButtonConfig {
  icon: React.ReactNode
  tooltip: string
  variant: "brand-primary" | "neutral-secondary"
}

const CONFIGS: Record<ChatButtonMode, ButtonConfig> = {
  send: { icon: <Send />, tooltip: "Send", variant: "brand-primary" },
  "skip-ask": { icon: <SkipForward />, tooltip: "Skip question", variant: "neutral-secondary" },
  cancel: { icon: <StopCircle />, tooltip: "Cancel", variant: "neutral-secondary" },
  "cancel-plan": { icon: <ListX />, tooltip: "Cancel plan", variant: "neutral-secondary" },
}

interface ChatSendButtonProps {
  mode: ChatButtonMode
  disabled?: boolean
  onSend: () => void
  onSkipAsk: () => void
  onCancel: () => void
  onCancelPlan: () => void
}

export const ChatSendButton = ({
  mode,
  disabled,
  onSend,
  onSkipAsk,
  onCancel,
  onCancelPlan,
}: ChatSendButtonProps) => {
  const { icon, tooltip, variant } = CONFIGS[mode]
  const onClick = {
    send: onSend,
    "skip-ask": onSkipAsk,
    cancel: onCancel,
    "cancel-plan": onCancelPlan,
  }[mode]
  return (
    <TooltipWrap text={tooltip}>
      <IconButton
        variant={variant}
        size="small"
        icon={icon}
        onClick={onClick}
        disabled={disabled}
      />
    </TooltipWrap>
  )
}
