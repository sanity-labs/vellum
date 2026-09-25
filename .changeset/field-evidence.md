---
'@sanity-labs/vellum': minor
---

`convertDocument` results include `evidence`, keyed by field path like `confidence`. Each entry says whether the field was filled or left empty and why: the source block and exact text a value was copied from, the probability of each answer Jev gave to "which part of the source supplies this field?", and the signals that accepted it.
