import type { ToolDeps } from "../types"
import { getToolHandlers } from "./tool"
import { createExecutor } from "./execute"
import { withModeAwareness } from "./delegation"

import "../tools/cancel/handler"
import "../tools/complete-step/handler"
import "../tools/copy-file/handler"
import "../tools/create-file/handler"
import "../tools/edit-file/handler"
import "../tools/rename-file/handler"
import "../tools/remove-file/handler"
import "../tools/block-tools/register"
import "../tools/run-local-shell/handler"
import "../tools/ask/handler"
import "../tools/submit-plan/handler"
import "../tools/compact/handler"
import "../tools/apply-deep-analysis/handler"
import "../tools/start-planning/handler"
import "../tools/query/handler"
import "../tools/search/handler"
import "../tools/refine-code/handler"

export type { ToolDeps }

export const createToolExecutor = (_deps: ToolDeps) =>
  withModeAwareness(createExecutor(getToolHandlers()))
