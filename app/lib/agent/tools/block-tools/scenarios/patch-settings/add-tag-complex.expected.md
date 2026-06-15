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
			"label": "fiscal",
			"display": "Fiscal",
			"color": "sky",
			"icon": "calendar-days"
		},
		{
			"id": "tag-9a8b7c6d",
			"label": "analysis",
			"display": "Analysis",
			"color": "violet",
			"icon": "chart-line"
		}
	],
	"searches": [
		{
			"id": "search-7h7ukwlu",
			"title": "Blue annotations",
			"description": "All annotations with blue color",
			"highlight": "",
			"saved": false,
			"createdAt": 1775821756305,
			"sql": "SELECT file, id, text FROM annotations WHERE color = 'blue'"
		}
	]
}
```
