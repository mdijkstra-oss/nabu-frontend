import type { Bm25Hit } from "~/lib/search/bm25/store"
import type { SearchEntry, SearchHit } from "~/domain/search/types"
import type { TagDefinition } from "~/domain/data-blocks/settings/schema"

export const stackHits: Bm25Hit[] = [
  {
    id: "h1",
    hash: "h1",
    file: "field_notes.md",
    chunkStart: 0,
    chunkEnd: 120,
    score: 4.2,
    text: "The river rose overnight and the crossing at the ford was impassable until noon.",
  },
  {
    id: "h2",
    hash: "h2",
    file: "interview_maria.md",
    chunkStart: 40,
    chunkEnd: 180,
    score: 3.1,
    text: "Maria described the river as the town's calendar; everything was timed to its floods.",
  },
]

export const corpusHits: Bm25Hit[] = [
  {
    id: "c1",
    hash: "c1",
    file: "archive_letters.md",
    chunkStart: 0,
    chunkEnd: 90,
    score: 2.4,
    text: "A letter from 1901 mentions the river freezing solid for the first time in memory.",
  },
  {
    id: "c2",
    hash: "c2",
    file: "press_clippings.md",
    chunkStart: 10,
    chunkEnd: 130,
    score: 1.9,
    text: "The gazette ran a column on the river ferry closing after the new bridge opened.",
  },
]

export const recentSearches: SearchEntry[] = [
  {
    id: "s1",
    title: "River flooding accounts",
    description: "Passages about seasonal floods and their aftermath",
    highlight: "",
    saved: false,
    createdAt: "2024-12-24T01:46:40.000Z",
    sql: "",
  },
  {
    id: "s2",
    title: "Calendar metaphors",
    description: "Where informants describe time through natural cycles",
    highlight: "",
    saved: false,
    createdAt: "2024-12-25T05:33:20.000Z",
    sql: "",
  },
]

export const savedSearches: SearchEntry[] = [
  {
    id: "s3",
    title: "Ford crossings",
    description: "Mentions of the ford and who controlled it",
    highlight: "",
    saved: true,
    createdAt: "2024-12-22T22:00:00.000Z",
    sql: "",
  },
]

export const tagDefinitions: TagDefinition[] = [
  { id: "t1", label: "interview", color: "tomato", icon: "tag" },
  { id: "t2", label: "field-notes", color: "ruby", icon: "book" },
]

export const detailHits: SearchHit[] = [
  {
    file: "field_notes.md",
    text: "The river rose overnight. The crossing at the ford was impassable until noon.",
    score: 0.8123,
    matches: ["The river rose overnight."],
  },
  {
    file: "field_notes.md",
    text: "By evening the water had settled back into its banks.",
    score: 0.6521,
  },
  {
    file: "field_notes.md",
    text: "Children played along the exposed sandbars the next morning.",
    score: 0.6017,
  },
]
