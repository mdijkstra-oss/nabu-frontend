export interface ToolDeps {
  project?: { id: string }
  navigate?: (url: string) => void
}

export type ToolResult<T> =
  | { status: "ok"; output: T; message?: string; hint?: string; directive?: string }
  | { status: "partial"; output: T; message?: string; hint?: string; directive?: string }
  | { status: "error"; output: string; message?: string; hint?: string; directive?: string }

export type RawFiles = Map<string, string>

export type Operation =
  | { type: "write_file"; path: string; content: string; skipBlockValidation?: boolean }
  | { type: "delete_file"; path: string }
  | { type: "rename_file"; path: string; newPath: string }

export type HandlerResult<T> = ToolResult<T> & {
  mutations: Operation[]
  hint?: string
  directive?: string
}

export type Handler<T = unknown> = (
  files: RawFiles,
  args: Record<string, unknown>
) => Promise<HandlerResult<T>>
