import { describe, it, expect } from "vitest"
import { matchesFilter, matchesAny, matchesAllWords, matchesWordsInOrder } from "./filter"

describe("matchesFilter", () => {
  const cases = [
    { query: "", text: "anything", expected: true, name: "empty query matches all" },
    { query: "  ", text: "anything", expected: true, name: "whitespace query matches all" },
    { query: "foo", text: "foobar", expected: true, name: "prefix match" },
    { query: "bar", text: "foobar", expected: true, name: "suffix match" },
    { query: "oba", text: "foobar", expected: true, name: "middle match" },
    { query: "FOO", text: "foobar", expected: true, name: "case insensitive query" },
    { query: "foo", text: "FOOBAR", expected: true, name: "case insensitive text" },
    { query: "baz", text: "foobar", expected: false, name: "no match" },
    { query: "foo bar", text: "foobar", expected: false, name: "space in query no match" },
    {
      query: "policy commitment",
      text: "policy-commitment",
      expected: true,
      name: "space matches hyphen",
    },
    {
      query: "policy-commitment",
      text: "policy commitment",
      expected: true,
      name: "hyphen matches space",
    },
    { query: "foo bar", text: "foo_bar", expected: true, name: "space matches underscore" },
    { query: "foo bar", text: "foo.bar", expected: true, name: "space matches dot" },
    { query: "foo.bar", text: "foo bar", expected: true, name: "dot matches space" },
  ]

  it.each(cases)("$name", ({ query, text, expected }) => {
    expect(matchesFilter(query, text)).toBe(expected)
  })
})

describe("matchesAny", () => {
  const cases = [
    { query: "foo", texts: ["foo", "bar"], expected: true, name: "matches first" },
    { query: "bar", texts: ["foo", "bar"], expected: true, name: "matches second" },
    { query: "baz", texts: ["foo", "bar"], expected: false, name: "matches none" },
    { query: "", texts: ["foo", "bar"], expected: true, name: "empty matches all" },
    { query: "foo", texts: [], expected: false, name: "empty texts array" },
  ]

  it.each(cases)("$name", ({ query, texts, expected }) => {
    expect(matchesAny(query, texts)).toBe(expected)
  })
})

describe("matchesAllWords", () => {
  const cases = [
    { query: "", texts: ["foo"], expected: true, name: "empty query matches all" },
    { query: "  ", texts: ["foo"], expected: true, name: "whitespace query matches all" },
    { query: "foo", texts: ["foobar"], expected: true, name: "single word partial match" },
    {
      query: "foo bar",
      texts: ["foobar", "baz bar"],
      expected: true,
      name: "both words found across texts",
    },
    {
      query: "report bar",
      texts: ["Annual Report", "Bar Chart"],
      expected: true,
      name: "words matched across title and document",
    },
    {
      query: "report baz",
      texts: ["Annual Report", "Bar Chart"],
      expected: false,
      name: "one word missing",
    },
    {
      query: "REPORT bar",
      texts: ["annual report", "bar chart"],
      expected: true,
      name: "case insensitive",
    },
    { query: "foo", texts: [], expected: false, name: "empty texts no match" },
    { query: "a b c", texts: ["abc"], expected: true, name: "all words found in single text" },
    {
      query: "x y",
      texts: ["x marks", "the y"],
      expected: true,
      name: "words spread across texts",
    },
    {
      query: "policy commitment",
      texts: ["policy-commitment report"],
      expected: true,
      name: "space matches hyphen separator",
    },
  ]

  it.each(cases)("$name", ({ query, texts, expected }) => {
    expect(matchesAllWords(query, texts)).toBe(expected)
  })
})

describe("matchesWordsInOrder", () => {
  const cases = [
    { query: "", texts: ["foo"], expected: true, name: "empty query matches all" },
    { query: "  ", texts: ["foo"], expected: true, name: "whitespace query matches all" },
    { query: "foo", texts: ["foobar"], expected: true, name: "single word partial match" },
    {
      query: "foo bar",
      texts: ["foobar bazbar"],
      expected: true,
      name: "words in order within single text",
    },
    {
      query: "bar foo",
      texts: ["foobar bazbar"],
      expected: false,
      name: "words out of order rejected",
    },
    {
      query: "foo baz",
      texts: ["foobar", "bazbar"],
      expected: true,
      name: "words in order across texts",
    },
    {
      query: "baz foo",
      texts: ["foobar", "bazbar"],
      expected: false,
      name: "words reversed across texts rejected",
    },
    {
      query: "CORPUS desc",
      texts: ["corpus-describer endpoint"],
      expected: true,
      name: "case insensitive with separator normalization",
    },
    { query: "a b c", texts: ["a x b x c"], expected: true, name: "three words in order" },
    { query: "a c b", texts: ["a x b x c"], expected: false, name: "three words out of order" },
    { query: "foo", texts: [], expected: false, name: "empty texts no match" },
    {
      query: "policy report",
      texts: ["policy-commitment report"],
      expected: true,
      name: "hyphen normalized to space preserves order",
    },
  ]

  it.each(cases)("$name", ({ query, texts, expected }) => {
    expect(matchesWordsInOrder(query, texts)).toBe(expected)
  })
})
