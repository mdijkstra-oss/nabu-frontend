import type { z } from "zod"
import type { CallResult } from "~/lib/agent/client/call-parse"
import type { Message } from "~/lib/agent/tools/apply-deep-analysis/messages"

export type ParseCall = <T>(
  endpoint: string,
  messages: Message[],
  schema: z.ZodType<T>
) => Promise<CallResult<T>>
