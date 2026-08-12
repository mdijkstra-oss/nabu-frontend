# Date

A date region is a stretch of a document that describes one point or day in time:
a diary entry, a dated section of field notes, a meeting record.

## Where an occurrence sits

An occurrence is the place the document states the date the following text is about.
It takes several forms:

- A dated heading — `## 3 March 2026`, `### Monday`, `2026-03-03`.
- An opening line — "Tuesday, and it rained all morning."
- An explicit statement of when — "On the third of March we returned to the site."

The quote is the words that state the date, as the document writes them, without the
surrounding sentence.

A date mentioned in passing is not an occurrence. "We had agreed this back in January"
inside an entry dated March names January and does not make the text January's, so it
produces no occurrence.

## The value

The value is an ISO-8601 timestamp in UTC with a `Z` suffix — `2026-03-03T00:00:00Z`.

A phrase naming a day and no time resolves to the start of that day. A phrase naming
a time resolves to that time. Where the document states a year elsewhere and the
occurrence omits it, use the document's year; where no year can be established at all,
the phrase is not a date and produces no occurrence.

Relative phrases — "yesterday", "the following week" — resolve only when the document
gives you a date to count from. Otherwise they produce no occurrence.

## How far a region reaches

A date's region runs from the text the date introduces to the point the next date
takes over. A dated heading owns everything beneath it until the next dated heading.

Where the date sits inside the first sentence of its own entry, the region starts at
that sentence rather than after it.
