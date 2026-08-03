# Grounded answers

Every name and every quotation in an answer the model writes is a link. Click a code and its definition opens; click a quoted sentence and its document opens, scrolled to that sentence and underlined.

Two passes over the model's text produce that, run after it is written rather than through any citation format the model has to get right: identifiers are resolved to the things they name, and quotes are matched back to the passage they came from. It is the property [search results](02-querying.md) already have, carried into prose.

## Identifiers become names

Entity ids are written as a prefix and eight characters — `callout-3kf9m2qp` — and the prefixes come from the block registry, so every declared block type is scannable without a list maintained by hand. Filenames count as entities too.

An id that resolves is replaced by its name, linked to its definition, and rendered as a pill. The name comes from the block's `labelKey`, the same field the model sees when blocks are listed back to it, so a code called one thing in the codebook cannot be called something else in an answer.

Colour comes from the entity itself. A code's pill carries the code's own colour and a tag's carries the tag's, so a reference in a sentence is recognisable as the thing it names before it is read. Files take one fixed colour, since a filename is a filename.

Two details matter more than they look. An id that resolves to nothing is left exactly as written rather than linked to a dead target, so a hallucinated reference stays visible as one. And where the model writes the name and the id together — the redundancy it tends toward — the duplicate is absorbed into the link instead of being rendered twice.

Tags resolve on the same principle by slug, as `#covid-19`.

## Quotes become passages

Anything in curly quotes is a candidate. Filenames, single words and text already inside a link are skipped, and the rest is matched against the open document's content. A quote that matches becomes a link carrying the quoted text itself, not a character offset — offsets go stale the moment the document is edited, and the text does not.

A quote that matches nothing is left as plain quoted text. The absence of a link is the signal that the passage could not be found.

> [!NOTE]
> As of now: Quote matching runs against the document currently open, so a quotation from elsewhere in the corpus stays plain text. What makes it work in practice is that search results carry their source file, so the document the answer is about is usually the document in front of you.

## How close a match has to be

Text is tokenised into words, lowercased and stripped of accents and punctuation, so a quote survives the model reflowing whitespace, changing quotation marks or dropping a comma.

An exact run of tokens is tried first. Failing that, a window of the same length is scored by how much of the quote appears in order, and accepted at 100%, then 95%, then 90% — so a long quote can lose a word in ten and still resolve. Quotes shorter than five tokens skip the fuzzy pass entirely and must match exactly, since at that length a loose match lands on the wrong sentence more often than the right one.

## Following one

A resolved link carries either the entity id or the quoted text. Opening it loads the document and scrolls to the target, and where the document is still rendering, the scroll waits for it to settle rather than failing silently.

The matched range is then underlined in place. The reader lands on the sentence the claim was drawn from, in its own document, with everything around it intact — which is the difference between checking a claim and taking it.

## Asking for quotable answers

Resolution can only work on text that quotes in the first place, so the analysis pass says so directly:

```text
Ground every observation in source text. 1-2 quotes per pattern — the quote
must directly demonstrate the pattern; if you need to explain relevance, pick
a better one. Scale claims to evidence: one quote → "in at least one instance";
multiple passages → "recurrently."
```

Requiring the quote to carry the point on its own is what makes it checkable: a quote chosen to demonstrate a pattern resolves to the passage that demonstrates it, and a quote chosen to decorate a claim resolves to a sentence that does not support it — visibly, to the reader who clicks.

## Next: consensus

Grounding makes one answer checkable. [Consensus](04-consensus.md) is the same problem at volume: where a judgement is subjective and has to be made thousands of times, one model's answer is an opinion, so two make it independently and the cases they split on come back as questions about the definition rather than about the text.
