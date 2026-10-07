---
'@sanity-labs/vellum': patch
---

An update that sets a list to `[]` now removes the field, the way Studio unsets an emptied array. It used to keep `[]`, which passes Sanity's required rule, so clearing a required list came back without an error. It now reports `Required`.
