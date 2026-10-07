---
'@sanity-labs/vellum': patch
---

A required array that maps to no items now reports `Required`. Vellum used to keep it as `[]`, which passes Sanity's required rule, so a post whose only author was a reference it can't keep came back without an error. Empty arrays are now left out, the way Studio unsets them.
