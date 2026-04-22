# Story: 069 - Global Price Comparison

**Persona:** Personal Shopper
**Objective:** Find the cheapest global price for a high-value collector's item.

## Narrative

I need to source a vintage Rolex for a client. I use the `ebay` tool via `ibr` 
to compare prices on eBay US and eBay UK.

## Instructions

```bash
# Search eBay US
ibr tool ebay --param query="vintage rolex datejust" --param domain="ebay.com"

# Search eBay UK
ibr tool ebay --param query="vintage rolex datejust" --param domain="ebay.co.uk"
```

## Augmentations

- **Remove Sponsored**: Hide sponsored listings to avoid skewed pricing data.
- **Rule**: `{"remove": [".s-item__sep", ".s-item__location"]}`
