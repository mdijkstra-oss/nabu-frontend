"use client"

import { useSyncExternalStore, cloneElement, type ReactElement } from "react"
import {
  getLoading,
  getAllBlocksWithDraft,
  subscribeLoading,
  subscribeBlocks,
} from "~/lib/agent/client/store"
import { getNabuStatus, type NabuStatus } from "~/lib/agent/client/status"
import { derive, hasActivePlan } from "~/lib/agent/derived"
import { TooltipWrap } from "~/ui/components/TooltipWrap"

const statusTooltip: Record<Exclude<NabuStatus, "idle">, string> = {
  busy: "Nabu is working...",
  planning: "Nabu is executing a plan...",
  "waiting-for-ask": "Nabu is waiting for your answer",
}

const subscribeAll = (listener: () => void): (() => void) => {
  const unsubLoading = subscribeLoading(listener)
  const unsubBlocks = subscribeBlocks(listener)
  return () => {
    unsubLoading()
    unsubBlocks()
  }
}

const getStatus = (): NabuStatus => {
  const history = getAllBlocksWithDraft()
  const inPlan = hasActivePlan(derive(history).plans)
  return getNabuStatus(getLoading(), history, inPlan)
}

export const useNabuStatus = (): NabuStatus =>
  useSyncExternalStore(subscribeAll, getStatus, getStatus)

interface NabuGateProps {
  tooltip?: string
  children: ReactElement<{ disabled?: boolean }>
}

export const NabuGate = ({ tooltip, children }: NabuGateProps) => {
  const status = useNabuStatus()

  if (status === "idle") {
    if (tooltip)
      return (
        <TooltipWrap text={tooltip}>
          <span>{children}</span>
        </TooltipWrap>
      )
    return children
  }

  return (
    <TooltipWrap text={statusTooltip[status]}>
      <span>{cloneElement(children, { disabled: true })}</span>
    </TooltipWrap>
  )
}
