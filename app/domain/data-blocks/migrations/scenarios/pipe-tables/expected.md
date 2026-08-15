# Quarterly review

Revenue by region.

```json-table
{
	"id": "table-1a2b3c4d",
	"caption": {
		"label": ""
	},
	"columns": [
		{
			"key": "region",
			"name": "Region",
			"type": "text"
		},
		{
			"key": "revenue",
			"name": "Revenue",
			"type": "number"
		},
		{
			"key": "started",
			"name": "Started",
			"type": "date"
		}
	],
	"rows": [
		{
			"region": "North",
			"revenue": "1200",
			"started": "2026-01-05"
		},
		{
			"region": "South",
			"revenue": "950.5",
			"started": "2026-02-11"
		},
		{
			"region": "East",
			"revenue": "n/a",
			"started": "2026-03-01"
		},
		{
			"region": "West",
			"revenue": "",
			"started": ""
		}
	]
}
```

Prose between the tables, with a pipe in it: either | or.

```json-table
{
	"id": "table-5e6f7a8b",
	"caption": {
		"label": ""
	},
	"columns": [
		{
			"key": "amount",
			"name": "Amount",
			"type": "number"
		},
		{
			"key": "column_2",
			"name": "column_2",
			"type": "text"
		},
		{
			"key": "amount_2",
			"name": "Amount",
			"type": "text"
		}
	],
	"rows": [
		{
			"amount": "1",
			"column_2": "a | b",
			"amount_2": "**bold**"
		}
	]
}
```

Closing line.
