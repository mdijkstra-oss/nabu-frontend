# Specs are history

Each directory under `docs/specs/` is a dated record of what was asked for and built, in order — the same way commit history is. They are a log, not documentation.

## A finished spec is never edited

Not to match code written since. Not to agree with a later spec that changed its mind. Not to correct something that turned out wrong.

A spec describes what was decided at its date. Editing it to match today's code destroys the only thing it records, and makes the date on its directory a lie.

## Changing specified behavior means a new directory

When behavior needs to change, write a new spec with today's date and the next sequence number. The later spec is simply what stands; nothing marks the earlier one as superseded, because reading them in order already says so.

## Only one spec is ever live

The spec currently being written or built. Every other directory here is closed.

## Naming

`<YYYY-MM-DD>-<NN>-<slug>/`, where `NN` continues one counter across every directory already here — highest plus one, zero-padded — and the slug names the feature in a few kebab-case words.

Inside: `spec.md` for the feature as a whole, and one file per component.
