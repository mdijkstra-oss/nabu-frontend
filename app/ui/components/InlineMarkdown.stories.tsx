import type { Meta, StoryObj } from "@storybook/react-vite"
import { InlineMarkdown } from "./InlineMarkdown"

const files: Record<string, string> = {
  "field-notes.md": "# Field notes\n\nObservations from the first site visit.",
  "interview-4.md": "# Interview 4\n\nTranscript of the fourth interview.",
}

const meta: Meta<typeof InlineMarkdown> = {
  title: "Custom/Primitives/InlineMarkdown",
  component: InlineMarkdown,
}

export default meta
type Story = StoryObj<typeof InlineMarkdown>

export const WithEntityLinks: Story = {
  args: {
    children:
      "The coding summary draws on field-notes.md and interview-4.md, with *emphasis* kept inline.",
    files,
    projectId: "p1",
    currentFile: null,
    currentFileContent: null,
  },
}
