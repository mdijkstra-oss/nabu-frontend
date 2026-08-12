import { fnvHash } from "~/lib/utils/hash"

const joinSentences = (sentences: string[]): string => sentences.join(" ")

// A mark's rangeHash has to be computable from the sentence array with no prose string in
// hand, so it is not the unit hash's recipe. The writer and the re-deriver have to agree
// on the separator.
export const hashSentences = (sentences: string[]): string => fnvHash(joinSentences(sentences))
