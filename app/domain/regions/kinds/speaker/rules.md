# Speaker

A speaker region is a stretch of a document that belongs to one person: what they
said, wrote, or are quoted as saying, or an act the document records them doing.

## Where an occurrence sits

An occurrence is the place the document names whose words or act these are. The
speech itself can take any shape — quoted directly, reported, or paraphrased: words
the document attributes to a person are theirs regardless of form. The naming takes
several forms:

- A turn label at the start of a line — `Rutte:`, `## Interviewer`, `[MARK]`.
- Trailing attribution after the words — "…, said Rutte", "— Rutte", "Rutte replied".
- A narrative introduction — "Rutte began by saying that…".
- A name with a reporting verb — "Bell reported that…", "Ms. Delgado proposed…" —
  the usual form in minutes and reports.
- A recorded act with no words at all — "Seconded by Ms. Delgado." — the minute
  book's way of naming who did a thing.

The quote is the words that name the person, as the document writes them. Take the
name and the marker that carries it when they are adjacent (`Rutte:`), and the name
alone when they are not. A title belongs with its name: "Mrs. Okafor" is one
occurrence, never two.

## What is never an occurrence

- A pronoun. "He continued" keeps the current speaker's region going and is not a
  new occurrence.
- A person given neither words nor an act. "We asked Rutte about it" in the
  interviewer's own turn names Rutte and gives him nothing, so it produces no
  occurrence unless his answer follows and is attributed to him.
- An attendance or apologies list. "Present: Mrs. Sharma (chair), Mr. Bell…"
  records who was in the room, not who did anything: however many people it names,
  it produces no occurrences at all.

## The value

The value is one person, in a form short enough to be an identifier: lowercase, no
titles, no punctuation. `rutte`, not `President Rutte` or `Mr. Rutte`. A person with
no name in the document takes the role the document gives them — `interviewer`,
`respondent`, `narrator`.

The same person must get the same value everywhere, so reuse a value from the list
you are given whenever the occurrence is that person, even when the document spells
the name differently this time. Coin a new value only when nobody on the list is
this person.

## How far a region reaches

A speaker's region is every sentence whose words are theirs, or whose act it
records. It ends at the last sentence they own — not at the next attribution
marker, which belongs to the next speaker. Sentences that carry on with a pronoun — "She went on to recommend…" —
still belong to the speaker last named; the naming switching to a pronoun does not
end the region.

A recorded act reaches only the sentence or sentences that record it: "Seconded by
Ms. Delgado. Carried." is Delgado's, and nothing more.

Regions of two people may overlap. A recorded act or a brief interjection inside
someone's turn belongs to its own person without ending the surrounding region, and
a sentence the document gives to two people jointly — "Mr. and Mrs. Given
reported…" — sits in a region of each.

Where attribution trails the words ("This is great, said Rutte"), the region starts
before the attribution and includes it: the sentence naming the speaker is part of
what they said.

Stage directions, timestamps and interviewer notes that sit inside a turn stay inside
it. A heading that introduces a new section does not belong to the speaker before it.
