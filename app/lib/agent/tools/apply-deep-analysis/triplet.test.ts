import { describe, it, expect } from "vitest"
import { renderTripletSection } from "./triplet"
import type { CodedItem } from "./present"

const sentences = [
  "We started the workshop with a brief introduction.",
  "Most participants stayed quiet during the warm-up.",
  "Sara jumped in first.",
  "Once she spoke, two more people followed.",
  "The facilitator nodded.",
]

const emptyEdge = { leading: "", trailing: "" }

describe("renderTripletSection", () => {
  const cases = [
    {
      name: "single candidate, halo fits inside section",
      items: [{ start: 3, end: 3, codings: ["participation"] }] as CodedItem[],
      halo: 1,
      edge: emptyEdge,
      expectedText: [
        "[target]",
        "Most participants stayed quiet during the warm-up.",
        `[candidate id="1" code="participation"]Sara jumped in first.[/candidate]`,
        "Once she spoke, two more people followed.",
        "[/target]",
      ].join("\n"),
    },
    {
      name: "candidate at section start spills into leading",
      items: [{ start: 1, end: 1, codings: ["p"] }] as CodedItem[],
      halo: 2,
      edge: { leading: "Prior section context.", trailing: "" },
      expectedText: [
        "[target]",
        "Prior section context.",
        `[candidate id="1" code="p"]We started the workshop with a brief introduction.[/candidate]`,
        "Most participants stayed quiet during the warm-up. Sara jumped in first.",
        "[/target]",
      ].join("\n"),
    },
    {
      name: "candidate at section end spills into trailing",
      items: [{ start: 5, end: 5, codings: ["p"] }] as CodedItem[],
      halo: 2,
      edge: { leading: "", trailing: "Following section context." },
      expectedText: [
        "[target]",
        "Sara jumped in first. Once she spoke, two more people followed.",
        `[candidate id="1" code="p"]The facilitator nodded.[/candidate]`,
        "Following section context.",
        "[/target]",
      ].join("\n"),
    },
    {
      name: "multi-sentence candidate",
      items: [{ start: 2, end: 3, codings: ["p"] }] as CodedItem[],
      halo: 1,
      edge: emptyEdge,
      expectedText: [
        "[target]",
        "We started the workshop with a brief introduction.",
        `[candidate id="1" code="p"]Most participants stayed quiet during the warm-up. Sara jumped in first.[/candidate]`,
        "Once she spoke, two more people followed.",
        "[/target]",
      ].join("\n"),
    },
    {
      name: "halo zero omits before and after",
      items: [{ start: 3, end: 3, codings: ["p"] }] as CodedItem[],
      halo: 0,
      edge: emptyEdge,
      expectedText: [
        "[target]",
        `[candidate id="1" code="p"]Sara jumped in first.[/candidate]`,
        "[/target]",
      ].join("\n"),
    },
    {
      name: "no leading available, no spill written",
      items: [{ start: 1, end: 1, codings: ["p"] }] as CodedItem[],
      halo: 3,
      edge: emptyEdge,
      expectedText: [
        "[target]",
        `[candidate id="1" code="p"]We started the workshop with a brief introduction.[/candidate]`,
        "Most participants stayed quiet during the warm-up. Sara jumped in first. Once she spoke, two more people followed.",
        "[/target]",
      ].join("\n"),
    },
    {
      name: "two candidates produce two target blocks joined by blank line",
      items: [
        { start: 1, end: 1, codings: ["a"] },
        { start: 5, end: 5, codings: ["b"] },
      ] as CodedItem[],
      halo: 1,
      edge: emptyEdge,
      expectedText: [
        "[target]",
        `[candidate id="1" code="a"]We started the workshop with a brief introduction.[/candidate]`,
        "Most participants stayed quiet during the warm-up.",
        "[/target]",
        "",
        "[target]",
        "Once she spoke, two more people followed.",
        `[candidate id="2" code="b"]The facilitator nodded.[/candidate]`,
        "[/target]",
      ].join("\n"),
    },
    {
      name: "custom item.id used as label",
      items: [{ start: 3, end: 3, codings: ["p"], id: "ann-7" }] as CodedItem[],
      halo: 0,
      edge: emptyEdge,
      expectedText: [
        "[target]",
        `[candidate id="ann-7" code="p"]Sara jumped in first.[/candidate]`,
        "[/target]",
      ].join("\n"),
    },
    {
      name: "multi-code candidate joins codes with comma",
      items: [{ start: 3, end: 3, codings: ["a", "b"] }] as CodedItem[],
      halo: 0,
      edge: emptyEdge,
      expectedText: [
        "[target]",
        `[candidate id="1" code="a, b"]Sara jumped in first.[/candidate]`,
        "[/target]",
      ].join("\n"),
    },
  ]

  cases.forEach(({ name, items, halo, edge, expectedText }) => {
    it(name, () => {
      const result = renderTripletSection(sentences, items, halo, edge)
      expect(result.text).toBe(expectedText)
      expect(result.mapping).toHaveLength(items.length)
      result.mapping.forEach((m, i) => {
        expect(m.index).toBe(i + 1)
        expect(m.start).toBe(items[i].start)
        expect(m.end).toBe(items[i].end)
        expect(m.codings).toEqual(items[i].codings)
      })
    })
  })
})
