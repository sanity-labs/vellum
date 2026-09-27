---
'@sanity-labs/vellum': patch
---

URL fields only take `http(s)`, `mailto` and `tel` links or relative paths, so labeled lines like `Venue: Oslo` are no longer offered as URLs. A missing required value reports `Required` once instead of failing every rule on its path, and validation messages name array items by index (`items[0].title`) instead of by `_key`.
