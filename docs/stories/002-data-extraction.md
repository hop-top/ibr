# 002 - Data Extraction

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Extract structured data (scalars and lists) from a page using natural language
field names.

## Stories

- As a CLI user, I write `extract: title, price, rating` to pull named fields
  from the current page into a JSON result.
- As a CLI user, I write `extract all product names` to collect a repeated
  element into a JSON array.
- As a CLI user, I receive extracted data printed to stdout on completion.

## Acceptance Criteria

- Scalar extraction returns a JSON object with requested keys.
- List extraction (`extract all …`) returns a JSON array.
- Missing fields return `null`; idx does not throw.
- Output is valid JSON on stdout.
