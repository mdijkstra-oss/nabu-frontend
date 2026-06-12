import { z } from "zod"

const CreateFileArgs = z.object({
  path: z.string().min(1).describe("Path of the new file"),
  content: z
    .string()
    .describe(
      "Raw file content. Newlines are literal. Do not include JSON block fences (`json-*`) — use `add_<type>` / `patch_<type>` after creating the file."
    ),
})

export const createFile = {
  name: "create_file" as const,
  description:
    "Create a new file with raw content. Fails if the file already exists. Cannot include JSON block fences (`json-*`) — those must be added via their dedicated tools.\n\nparallel: self=yes (different paths) / others=yes / fails if path overlaps an existing or sibling-created file",
  schema: CreateFileArgs,
}
