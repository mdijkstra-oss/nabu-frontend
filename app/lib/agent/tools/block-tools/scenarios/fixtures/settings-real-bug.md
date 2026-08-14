# Settings

```json-settings
{
    "tags": [
        {
            "id": "tag-5p9cz6tg",
            "label": "codebook",
            "display": "Codebook",
            "color": "indigo",
            "icon": "book-open"
        },
        {
            "id": "tag-8qu5a1xb",
            "label": "2020",
            "display": "2020",
            "color": "sky",
            "icon": "calendar-days"
        },
        {
            "id": "tag-177qx9av",
            "label": "2021",
            "display": "2021",
            "color": "teal",
            "icon": "calendar-days"
        },
        {
            "id": "tag-2kqia3ad",
            "label": "2022",
            "display": "2022",
            "color": "indigo",
            "icon": "calendar-days"
        },
        {
            "id": "tag-bj3n7qkm",
            "label": "ministerraad",
            "display": "Ministerraad",
            "color": "purple",
            "icon": "building"
        },
        {
            "id": "tag-hx4v8lpd",
            "label": "persconferentie",
            "display": "Persconferentie",
            "color": "red",
            "icon": "mic"
        },
        {
            "id": "tag-mt6r2swn",
            "label": "persmoment",
            "display": "Persmoment",
            "color": "amber",
            "icon": "megaphone"
        },
        {
            "id": "tag-qk9z5fyc",
            "label": "toespraak",
            "display": "Toespraak",
            "color": "jade",
            "icon": "speech"
        },
        {
            "id": "tag-j7m4q2vd",
            "label": "memo",
            "display": "Memo",
            "color": "amber",
            "icon": "sticky-note"
        }
    ],
    "searches": [
        {
            "id": "search-7h7ukwlu",
            "title": "callout-6rdkyy3u",
            "description": "Passages coded as: callout-6rdkyy3u",
            "highlight": "",
            "saved": false,
            "createdAt": "2026-04-10T11:49:16.305Z",
            "sql": "SELECT file, id, text FROM annotations WHERE code = 'callout-6rdkyy3u'"
        },
        {
            "id": "search-2z9zvaxl",
            "title": "callout-4b86qohn",
            "description": "Passages coded as: callout-4b86qohn",
            "highlight": "",
            "saved": false,
            "createdAt": "2026-04-10T07:41:33.821Z",
            "sql": "SELECT file, id, text FROM annotations WHERE code = 'callout-4b86qohn'"
        },
        {
            "id": "search-418z2ymz",
            "title": "Rutte recall moments",
            "description": "Date-titled transcripts where Rutte says he does not remember, does not know exactly, needs to look something up first, or otherwise lacks recall in the moment.",
            "highlight": "The specific passage where Rutte says he does not remember, does not know exactly, lacks recollection, does not have the detail at hand, or says he needs to check first before answering.",
            "saved": false,
            "createdAt": "2026-04-09T21:33:48.838Z",
            "sql": "SELECT f.file, f.text, SEMANTIC('passages spoken by Mark Rutte in interviews press conferences or ministerraad transcripts where he says he does not remember, has no recollection, does not know exactly anymore, does not have it readily available, or first needs to check or read something before answering') FROM files f WHERE f.file ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}_.*\\.md\n"
        }
    ]
}
```
