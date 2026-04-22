# Story: 065 - Historical Property Research

**Persona:** Homeowner
**Objective:** Research historical gas prices or community news from a specific date.

## Narrative

I want to know how the neighborhood changed. I use `ibr` to navigate the 
Wayback Machine and look at the community forum as it appeared in January 2022.

## Instructions

```yaml
url: https://web.archive.org/web/20220101000000*/https://miniflux.app/blog
instructions:
  - click on the first snapshot from January 2022
  - wait for the page to load
  - extract the main headline from that date
```

## Augmentations

- **Remove Wayback UI**: Hide the top banner and timeline to simplify the view for the AI.
- **Rule**: `{"remove": ["#wm-ipp-base"]}`
