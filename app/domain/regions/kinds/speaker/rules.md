# Speaker

A speaker region is a stretch of a document whose words belong to one person: what
they said, wrote, or are quoted as saying.

## Where an occurrence sits

An occurrence is the place the document names who is talking. The speech itself can
take any shape — quoted directly, reported, or paraphrased: words the document
attributes to a person are theirs regardless of form. The naming takes several forms:

- A turn label at the start of a line — `Rutte:`, `## Interviewer`, `[MARK]`.
- Trailing attribution after the words — "…, said Rutte", "— Rutte", "Rutte replied".
- A narrative introduction — "Rutte began by saying that…".
- A name with a reporting verb — "Bell reported that…", "Ms. Delgado proposed…",
  "Mrs. Okafor mentioned…" — the usual form in minutes and reports.

The quote is the words that name the person, as the document writes them. Take the
name and the marker that carries it when they are adjacent (`Rutte:`), and the name
alone when they are not. The quote is a name or a role, never a pronoun: "He
continued" keeps the current speaker's region going and is not a new occurrence.

A person mentioned but not speaking is not an occurrence. "We asked Rutte about it"
in the interviewer's own turn names Rutte and gives him no words, so it produces no
occurrence unless his answer follows and is attributed to him. "Seconded by
Mrs. Okafor. Carried." records a vote, not words spoken, so it names no speaker.

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

A speaker's region is every sentence whose words are theirs, up to the point another
speaker takes over. It ends at the last sentence they own — not at the next
attribution marker, which belongs to the next speaker.

Where attribution trails the words ("This is great, said Rutte"), the region starts
before the attribution and includes it: the sentence naming the speaker is part of
what they said.

Stage directions, timestamps and interviewer notes that sit inside a turn stay inside
it. A heading that introduces a new section does not belong to the speaker before it.
