import { describe, test, expect } from "vitest"
import { resolveEntityLink, type ResolvedLink, type EntityIcons } from "./resolve"
import type { FileStore } from "~/lib/files/store"

const StubIcon = () => null

const icons: EntityIcons = {
  file: StubIcon,
  spotlight: StubIcon,
}

const fileWithAnnotation = (id: string, text: string, color: string): string =>
  `# Doc\n\n\`\`\`json-annotations\n${JSON.stringify({ annotations: [{ id, text, color, reason: "test" }] })}\n\`\`\``

const fileWithCallout = (id: string, title: string, color: string): string =>
  `# Codebook\n\n\`\`\`json-callout\n${JSON.stringify({ id, type: "codebook-code", title, content: "detail", color, collapsed: false })}\n\`\`\``

const fileWithTagDefinition = (
  id: string,
  label: string,
  display: string,
  color: string,
  icon: string
): string =>
  `# Prefs\n\n\`\`\`json-settings\n${JSON.stringify({ tags: [{ id, label, display, color, icon }] })}\n\`\`\``

describe("resolveEntityLink", () => {
  const cases: {
    name: string
    href: string
    files: FileStore
    expected: Partial<ResolvedLink> | null
  }[] = [
    {
      name: "returns null for non-file link",
      href: "https://example.com",
      files: {},
      expected: null,
    },
    {
      name: "resolves annotation ref",
      href: "file://annotation-abc",
      files: { "doc.md": fileWithAnnotation("annotation-abc", "hello world", "red") },
      expected: {
        kind: "annotation",
        colors: {
          text: "var(--red-11)",
          icon: "var(--red-9)",
          background: "var(--red-3)",
          backgroundHover: "var(--red-4)",
        },
        url: "/project/proj1/file/doc.md?entity=annotation-abc",
        label: "hello world",
      },
    },
    {
      name: "returns null for missing annotation",
      href: "file://annotation-missing",
      files: { "doc.md": "# Empty" },
      expected: null,
    },
    {
      name: "resolves callout ref",
      href: "file://callout-xyz",
      files: { "codebook.md": fileWithCallout("callout-xyz", "My Code", "blue") },
      expected: {
        kind: "callout",
        colors: {
          text: "var(--blue-11)",
          icon: "var(--blue-9)",
          background: "var(--blue-3)",
          backgroundHover: "var(--blue-4)",
        },
        url: "/project/proj1/file/codebook.md?entity=callout-xyz",
        label: "My Code",
      },
    },
    {
      name: "returns null for missing callout",
      href: "file://callout-missing",
      files: {},
      expected: null,
    },
    {
      name: "resolves tag ref",
      href: "file://tag-abc12345",
      files: {
        "settings.hidden.md": fileWithTagDefinition(
          "tag-abc12345",
          "interview",
          "Interview",
          "green",
          "mic"
        ),
      },
      expected: {
        kind: "tag",
        colors: {
          text: "var(--green-11)",
          icon: "var(--green-9)",
          background: "var(--green-3)",
          backgroundHover: "var(--green-4)",
        },
        url: "",
        label: "Interview",
      },
    },
    {
      name: "returns null for missing tag",
      href: "file://tag-missing",
      files: {},
      expected: null,
    },
    {
      name: "resolves text ref without spotlight",
      href: "file://my-doc",
      files: {},
      expected: {
        kind: "text",
        colors: {
          text: "var(--color-brand-700)",
          icon: "var(--color-brand-600)",
          background: "var(--color-brand-100)",
          backgroundHover: "var(--color-brand-200)",
        },
        url: "/project/proj1/file/my-doc",
        label: "my-doc",
      },
    },
    {
      name: "resolves text ref with spotlight",
      href: "file://my-doc/hello%20world",
      files: {},
      expected: {
        kind: "text",
        colors: {
          text: "var(--color-neutral-700)",
          icon: "var(--color-neutral-500)",
          background: "var(--color-neutral-200)",
          backgroundHover: "var(--color-neutral-300)",
        },
        url: "/project/proj1/file/my-doc?spotlight=hello+world",
        label: '"hello world"',
      },
    },
  ]

  test.each(cases)("$name", ({ href, files, expected }) => {
    const result = resolveEntityLink(href, files, "proj1", icons)
    if (expected === null) {
      expect(result).toBeNull()
    } else {
      expect(result).toMatchObject(expected)
    }
  })
})
