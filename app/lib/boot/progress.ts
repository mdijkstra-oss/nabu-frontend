// The boot bar's weight layout and the step a viewer reads under it. The step
// is chosen by bar position, not by which files are still working: the engine
// runs its three stages concurrently across files, so there is no single true
// answer, and a position keeps the line moving forward only.

export const BOOT_WEIGHTS = {
  file: 35,
  db: 35,
  embed: 10,
  classify: 10,
  regions: 10,
} as const

const ENGINE_START = BOOT_WEIGHTS.file + BOOT_WEIGHTS.db

const STEPS = [
  { label: "Reading your documents...", weight: BOOT_WEIGHTS.embed },
  { label: "Tagging documents...", weight: BOOT_WEIGHTS.classify },
  { label: "Finding people and dates...", weight: BOOT_WEIGHTS.regions },
].map((step, index, steps) => ({
  label: step.label,
  ceiling: steps.slice(0, index + 1).reduce((sum, s) => sum + s.weight, ENGINE_START),
}))

export const bootLabel = (progress: number): string =>
  progress < ENGINE_START ? "" : (STEPS.find((step) => progress < step.ceiling)?.label ?? "")
