# Nested tables

- A list item holds one:

  ```json-table
  {
  	"id": "table-1a2b3c4d",
  	"caption": {
  		"label": ""
  	},
  	"columns": [
  		{
  			"key": "item",
  			"name": "Item",
  			"type": "text"
  		},
  		{
  			"key": "qty",
  			"name": "Qty",
  			"type": "number"
  		}
  	],
  	"rows": [
  		{
  			"item": "nails",
  			"qty": "12"
  		}
  	]
  }
  ```

> And a blockquote holds another:

```json-table
{
	"id": "table-1a2b3c4d",
	"caption": {
		"label": ""
	},
	"columns": [
		{
			"key": "fruit",
			"name": "Fruit",
			"type": "text"
		},
		{
			"key": "count",
			"name": "Count",
			"type": "number"
		}
	],
	"rows": [
		{
			"fruit": "pear",
			"count": "3"
		}
	]
}
```

> And the quote resumes after it.

Closing line.
