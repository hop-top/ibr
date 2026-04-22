# Story: 071 - Amazon Review Summary

**Persona:** Personal Shopper
**Objective:** Vet a product's quality using detailed review extraction.

## Narrative

I need to confirm if a specific laptop has overheating issues. I use the 
`amazon` tool via `ibr` to find the product and extract reviews that mention 
"heat" or "fan".

## Instructions

```bash
ibr tool amazon --param query="macbook pro m3 overheating" --param count=1
```

## Augmentations

- **Isolate Reviews**: Focus the AI on the customer review section.
- **Rule**: `{"isolate": ["#customerReviews", "#reviews-medley-footer"]}`
