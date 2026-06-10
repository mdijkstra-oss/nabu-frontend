import { describe, it, expect } from "vitest"
import { renderTargetBlocks } from "./triplet"
import type { CodedItem } from "./present"

const sentences = [
  "We started the workshop with a brief introduction.",
  "Most participants stayed quiet during the warm-up.",
  "Sara jumped in first.",
  "Once she spoke, two more people followed.",
  "The facilitator nodded.",
]

describe("renderTargetBlocks", () => {
  const cases = [
    {
      name: "single candidate, halo fits inside section",
      items: [{ start: 3, end: 3, codings: ["participation"] }] as CodedItem[],
      halo: 1,
      expectedBlocks: [
        [
          `<target id="1" code="participation">`,
          "Most participants stayed quiet during the warm-up.",
          `<marked>Sara jumped in first.</marked>`,
          "Once she spoke, two more people followed.",
          "</target>",
        ].join("\n"),
      ],
    },
    {
      name: "candidate at section start omits before",
      items: [{ start: 1, end: 1, codings: ["p"] }] as CodedItem[],
      halo: 2,
      expectedBlocks: [
        [
          `<target id="1" code="p">`,
          `<marked>We started the workshop with a brief introduction.</marked>`,
          "Most participants stayed quiet during the warm-up. Sara jumped in first.",
          "</target>",
        ].join("\n"),
      ],
    },
    {
      name: "candidate at section end omits after",
      items: [{ start: 5, end: 5, codings: ["p"] }] as CodedItem[],
      halo: 2,
      expectedBlocks: [
        [
          `<target id="1" code="p">`,
          "Sara jumped in first. Once she spoke, two more people followed.",
          `<marked>The facilitator nodded.</marked>`,
          "</target>",
        ].join("\n"),
      ],
    },
    {
      name: "multi-sentence candidate",
      items: [{ start: 2, end: 3, codings: ["p"] }] as CodedItem[],
      halo: 1,
      expectedBlocks: [
        [
          `<target id="1" code="p">`,
          "We started the workshop with a brief introduction.",
          `<marked>Most participants stayed quiet during the warm-up. Sara jumped in first.</marked>`,
          "Once she spoke, two more people followed.",
          "</target>",
        ].join("\n"),
      ],
    },
    {
      name: "halo zero omits before and after",
      items: [{ start: 3, end: 3, codings: ["p"] }] as CodedItem[],
      halo: 0,
      expectedBlocks: [
        [`<target id="1" code="p">`, `<marked>Sara jumped in first.</marked>`, "</target>"].join(
          "\n"
        ),
      ],
    },
    {
      name: "two candidates produce two separate blocks",
      items: [
        { start: 1, end: 1, codings: ["a"] },
        { start: 5, end: 5, codings: ["b"] },
      ] as CodedItem[],
      halo: 1,
      expectedBlocks: [
        [
          `<target id="1" code="a">`,
          `<marked>We started the workshop with a brief introduction.</marked>`,
          "Most participants stayed quiet during the warm-up.",
          "</target>",
        ].join("\n"),
        [
          `<target id="2" code="b">`,
          "Once she spoke, two more people followed.",
          `<marked>The facilitator nodded.</marked>`,
          "</target>",
        ].join("\n"),
      ],
    },
    {
      name: "custom item.id used as label",
      items: [{ start: 3, end: 3, codings: ["p"], id: "ann-7" }] as CodedItem[],
      halo: 0,
      expectedBlocks: [
        [
          `<target id="ann-7" code="p">`,
          `<marked>Sara jumped in first.</marked>`,
          "</target>",
        ].join("\n"),
      ],
    },
    {
      name: "multi-code candidate joins codes with comma",
      items: [{ start: 3, end: 3, codings: ["a", "b"] }] as CodedItem[],
      halo: 0,
      expectedBlocks: [
        [`<target id="1" code="a, b">`, `<marked>Sara jumped in first.</marked>`, "</target>"].join(
          "\n"
        ),
      ],
    },
    {
      name: "keepCase and removeCase emit sub-elements after marked",
      items: [
        {
          start: 3,
          end: 3,
          codings: ["p"],
          keepCase: "fits criterion A",
          removeCase: "weak evidence",
        },
      ] as CodedItem[],
      halo: 1,
      expectedBlocks: [
        [
          `<target id="1" code="p">`,
          "Most participants stayed quiet during the warm-up.",
          `<marked>Sara jumped in first.</marked>`,
          "Once she spoke, two more people followed.",
          `<keep-case>fits criterion A</keep-case>`,
          `<remove-case>weak evidence</remove-case>`,
          "</target>",
        ].join("\n"),
      ],
    },
    {
      name: "empty removeCase still emits empty sub-element",
      items: [
        { start: 3, end: 3, codings: ["p"], keepCase: "fits", removeCase: "" },
      ] as CodedItem[],
      halo: 0,
      expectedBlocks: [
        [
          `<target id="1" code="p">`,
          `<marked>Sara jumped in first.</marked>`,
          `<keep-case>fits</keep-case>`,
          `<remove-case></remove-case>`,
          "</target>",
        ].join("\n"),
      ],
    },
  ]

  cases.forEach(({ name, items, halo, expectedBlocks }) => {
    it(name, () => {
      const result = renderTargetBlocks(sentences, items, halo)
      expect(result.blocks).toEqual(expectedBlocks)
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
