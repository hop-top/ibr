# Story: 070 - Historical Value Research

**Persona:** Personal Shopper
**Objective:** Determine if an item is truly "on sale" by checking historical prices.

## Narrative

A client is looking at an "original" price of $500. I use `ibr` and the Wayback 
Machine to check what this item was selling for in 2021.

## Instructions

```yaml
url: https://web.archive.org/web/20210601000000/https://example-shop.com/item-123
instructions:
  - extract the price listed on the page
  - compare it with the current price on the live site
  - extract the description to see if the specs have changed
```

## Augmentations

- **Wayback Cleanup**: Hide the Wayback toolbar to ensure the AI only sees the 
  archived content.
- **Rule**: `{"remove": ["#wm-ipp-base"]}`
