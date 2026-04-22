# Story: 064 - Feed-based Insight Extraction

**Persona:** Homeowner
**Objective:** Extract summaries from a personal news feed about home energy efficiency.

## Narrative

I use Miniflux to follow energy-saving blogs. Instead of reading them all, I have my AI 
agent use `ibr` to extract the titles and summaries of the last 5 posts so I can decide 
what to prioritize for my home.

## Instructions

```yaml
url: https://miniflux.app/blog
instructions:
  - extract the titles and dates of the first 5 articles
  - for each article, extract the first paragraph of the description
```

## Augmentations

- **Isolate Content**: Remove headers and footers to focus the AI on the article list.
- **Rule**: `{"isolate": ["main"]}`
