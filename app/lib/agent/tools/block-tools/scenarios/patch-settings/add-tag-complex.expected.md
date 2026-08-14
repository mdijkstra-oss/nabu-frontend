# Settings

```json-settings
{
	"tags": [
		{
			"id": "tag-5p9cz6tg",
			"label": "codebook",
			"color": "indigo",
			"icon": "book-open",
			"display": "Codebook"
		},
		{
			"id": "tag-8qu5a1xb",
			"label": "fiscal",
			"color": "sky",
			"icon": "calendar-days",
			"display": "Fiscal"
		},
		{
			"id": "tag-9a8b7c6d",
			"label": "analysis",
			"color": "violet",
			"icon": "chart-line",
			"display": "Analysis"
		}
	],
	"searches": [
		{
			"id": "search-7h7ukwlu",
			"title": "Blue annotations",
			"description": "All annotations with blue color",
			"highlight": "",
			"saved": false,
			"createdAt": "2026-04-10T11:49:16.305Z",
			"sql": "SELECT file, id, text FROM annotations WHERE color = 'blue'"
		}
	]
}
```
