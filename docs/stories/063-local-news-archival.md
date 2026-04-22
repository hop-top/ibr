# Story: 063 - Local News Archival

**Persona:** Homeowner
**Objective:** Archive the front page of a community blog to the Wayback Machine.

## Narrative

As a homeowner, I want to preserve the history of our neighborhood by archiving the 
local community blog every time a major event is posted. I use `ibr` to navigate 
to `archive.org/save` and trigger a snapshot of the blog.

## Instructions

```yaml
url: https://web.archive.org/save
instructions:
  - fill "URL to save" with "https://miniflux.app/blog"
  - click "SAVE PAGE"
  - wait for "Job has been submitted" message
```

## Augmentations

- **Remove Overlays**: Archive.org sometimes shows donation banners that can block the "SAVE PAGE" button.
- **Rule**: `{"remove": ["#don-reg", ".banner"]}`
