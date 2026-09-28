---
'@sanity-labs/vellum': minor
---

Arrays of plain values, like a list of tags, fill from one line. `Tags: React, Open source` becomes `['React', 'Open source']`. The line is split on commas or semicolons, and every item has to fit the item type, including any predefined values. JSON Schema and Zod arrays of one plain type are no longer reported as unmapped, and **Apply changes** replaces the list when its line changes. The blog post starter has a `tags` field to show it.
