import { describe, test, expect } from "vitest"
import { linkifyQuotes } from "./quotes"

const FILE_CONTENT = `The participant expressed frustration with the onboarding flow.
They mentioned that "the signup process takes too long" and noted
several usability issues with the navigation menu.
Overall satisfaction was moderate despite the complaints.`

describe("linkifyQuotes", () => {
  const cases: {
    name: string
    text: string
    documentId: string | null
    fileContent: string | null
    expected: string
  }[] = [
    {
      name: "replaces quoted text found in file with spotlight link",
      text: 'They said "the signup process takes too long" during the interview.',
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected:
        "They said [the signup process takes too long](file://notes.md/the%20signup%20process%20takes%20too%20long) during the interview.",
    },
    {
      name: "leaves quoted text unchanged when not found in file",
      text: 'They said "something completely different" during the interview.',
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected: 'They said "something completely different" during the interview.',
    },
    {
      name: "skips quotes already inside a markdown link",
      text: 'See [the "quoted" thing](http://example.com) here.',
      documentId: "notes.md",
      fileContent: 'the "quoted" thing is here',
      expected: 'See [the "quoted" thing](http://example.com) here.',
    },
    {
      name: "handles curly quotes",
      text: "They said \u201Cthe signup process takes too long\u201D during the interview.",
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected:
        "They said [the signup process takes too long](file://notes.md/the%20signup%20process%20takes%20too%20long) during the interview.",
    },
    {
      name: "resolves multiple quotes independently",
      text: 'Found "frustration with the onboarding flow" and "usability issues with the navigation menu" in the data.',
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected:
        "Found [frustration with the onboarding flow](file://notes.md/frustration%20with%20the%20onboarding%20flow) and [usability issues with the navigation menu](file://notes.md/usability%20issues%20with%20the%20navigation%20menu) in the data.",
    },
    {
      name: "returns unchanged when documentId is null",
      text: 'They said "the signup process takes too long" here.',
      documentId: null,
      fileContent: FILE_CONTENT,
      expected: 'They said "the signup process takes too long" here.',
    },
    {
      name: "returns unchanged when fileContent is null",
      text: 'They said "the signup process takes too long" here.',
      documentId: "notes.md",
      fileContent: null,
      expected: 'They said "the signup process takes too long" here.',
    },
    {
      name: "skips single-word quotes",
      text: 'The word "moderate" appears in the text.',
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected: 'The word "moderate" appears in the text.',
    },
    {
      name: "returns empty string unchanged",
      text: "",
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected: "",
    },
    {
      name: "preserves text with no quotes",
      text: "No quotes here at all.",
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected: "No quotes here at all.",
    },
    {
      name: "skips quoted filenames so entity linkifier can claim them",
      text: 'The data is in "interviews.md" and worth reviewing.',
      documentId: "notes.md",
      fileContent: "The data is in interviews.md and worth reviewing.",
      expected: 'The data is in "interviews.md" and worth reviewing.',
    },
    {
      name: "skips curly-quoted filenames",
      text: "See \u201Cfield-notes.md\u201D for details.",
      documentId: "notes.md",
      fileContent: "See field-notes.md for details.",
      expected: "See \u201Cfield-notes.md\u201D for details.",
    },
    {
      name: "still spotlights non-filename quotes in same text as filenames",
      text: 'Look at "interviews.md" and "frustration with the onboarding flow" together.',
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected:
        'Look at "interviews.md" and [frustration with the onboarding flow](file://notes.md/frustration%20with%20the%20onboarding%20flow) together.',
    },
    {
      name: "skips quoted text that already contains a markdown link",
      text: '"[the signup process takes too long](file://notes.md/the%20signup%20process%20takes%20too%20long)" was flagged.',
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected:
        '"[the signup process takes too long](file://notes.md/the%20signup%20process%20takes%20too%20long)" was flagged.',
    },
    {
      name: "skips curly-quoted text that already contains a markdown link",
      text: "\u201C[frustration with the onboarding flow](file://notes.md/frustration%20with%20the%20onboarding%20flow)\u201D is notable.",
      documentId: "notes.md",
      fileContent: FILE_CONTENT,
      expected:
        "\u201C[frustration with the onboarding flow](file://notes.md/frustration%20with%20the%20onboarding%20flow)\u201D is notable.",
    },
  ]

  test.each(cases)("$name", ({ text, documentId, fileContent, expected }) => {
    expect(linkifyQuotes(text, documentId, fileContent)).toBe(expected)
  })
})
