export const PLACEHOLDER_LINES: readonly string[] = [
  "A fresh new document. What are we working on?",
  "Blank page, big plans.",
  "Nothing here yet. Let's change that.",
  "Every great insight starts on an empty page.",
  "The cursor is blinking expectantly.",
  "Go on, type something brilliant.",
  "An empty page never stays empty for long.",
  "First words are the hardest. Type anyway.",
  "All this space, just for you.",
  "A clean slate. Make it count.",
  "One blank page, endless possibilities.",
  "Somewhere to put all those ideas.",
  "Ready when you are.",
  "This page is waiting patiently.",
  "Big ideas welcome. Small ones too.",
  "Write something. Future you says thanks.",
  "It all starts with a first line.",
  "Say it here first.",
]

export const pickPlaceholderLine = (random: () => number = Math.random): string =>
  PLACEHOLDER_LINES[Math.floor(random() * PLACEHOLDER_LINES.length)]
