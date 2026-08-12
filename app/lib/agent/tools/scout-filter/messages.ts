import { toSystem } from "~/lib/agent/client/convert"
import { buildEntryMessages, type Entry } from "~/lib/calls/entry"
import type { Message } from "~/lib/calls/messages"

const CTA = "Return entry id ranges to exclude from analysis."

export const buildScoutFilterMessages = (
  framework: string,
  entries: readonly Entry<unknown>[]
): Message[] => buildEntryMessages({ stable: [toSystem(framework)], callToAction: CTA }, entries)
