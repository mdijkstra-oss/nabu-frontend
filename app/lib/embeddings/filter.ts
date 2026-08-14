import { SETTINGS_FILE, isHiddenFile } from "~/lib/files/filename"

const EXCLUDED_FILES = new Set(["preferences.md", SETTINGS_FILE])

const endsWithMd = (filename: string): boolean => filename.endsWith(".md")

export const isEmbeddableFile = (filename: string): boolean =>
  endsWithMd(filename) && !isHiddenFile(filename) && !EXCLUDED_FILES.has(filename)
