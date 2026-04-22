# Story: 066 - Competitor Pricing Audit

**Persona:** Business Manager
**Objective:** Compare current pricing with historical data to detect strategy shifts.

## Narrative

I need to know if our competitor has increased their prices. I use `ibr` to 
check their live pricing and then use the Wayback Machine to check what it 
was 6 months ago.

## Instructions

```yaml
url: https://web.archive.org/web/20231001000000/https://miniflux.app/pricing
instructions:
  - extract all pricing plan names and their costs
  - navigate to https://miniflux.app/pricing
  - extract current pricing plan names and costs
  - compare the two and flag any increases
```

## Augmentations

- **Cleanup plans**: Remove the "Sign up" buttons to focus on the text content.
- **Rule**: `{"remove": [".button-primary", ".button-secondary"]}`
