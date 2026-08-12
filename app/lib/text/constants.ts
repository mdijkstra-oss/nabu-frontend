export const CHARS_PER_TOKEN = 4

// A segment longer than this is a segmentation failure rather than a sentence: a document
// with no terminal punctuation comes back from the segmenter as one row. Nothing below
// this layer splits a sentence, so one of those becomes a unit, then a chunk, and then a
// request no embedding provider will accept. It matches UNIT_CEILING_CHARS, which is what
// makes that ceiling a real bound rather than a preference.
export const MAX_SENTENCE_CHARS = 2000
