# Story: 068 - ArXiv AI Research Feed

**Persona:** Business Manager
**Objective:** Maintain a pulse on the latest AI architecture breakthroughs.

## Narrative

I need to stay ahead of AI trends. I have my agent use the `arxiv` tool via `ibr` 
to extract the latest papers on "browser agents" every morning.

## Instructions

```bash
ibr tool arxiv --param query="cat:cs.AI AND browser agents" --param count=5
```

## Augmentations

- **Clean PDF Links**: Ensure the AI sees direct PDF links clearly.
- **Rule**: `{"addClass": ["direct-link", "a[href*='pdf']"]}`
