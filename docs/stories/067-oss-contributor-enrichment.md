# Story: 067 - OSS Contributor Enrichment

**Persona:** Business Manager
**Objective:** Identify and enrich a list of contributors from a relevant OSS project.

## Narrative

I want to find talent for our new browser team. I use `ibr` to go to the 
Playwright repository and extract the top contributors' GitHub handles and 
bios.

## Instructions

```yaml
url: https://github.com/microsoft/playwright/graphs/contributors
instructions:
  - wait for the contributor list to load
  - extract the top 10 contributor usernames
  - for each contributor, navigate to their profile and extract their blog URL
```

## Augmentations

- **Remove GitHub Headers**: Simplify the UI by removing the sticky header.
- **Rule**: `{"remove": [".Header", ".js-header-wrapper"]}`
