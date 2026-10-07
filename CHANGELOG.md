# @sanity-labs/vellum

## 0.2.1

### Patch Changes

- [#12](https://github.com/sanity-labs/vellum/pull/12) [`c6d09c1`](https://github.com/sanity-labs/vellum/commit/c6d09c1c6dd522c04e45c39bac9164668c16932e) Thanks [@kmelve](https://github.com/kmelve)! - The package no longer depends on `@vercel/analytics`, which 0.2.0 listed by mistake. Only the playground uses it.

- [#15](https://github.com/sanity-labs/vellum/pull/15) [`e5c72f1`](https://github.com/sanity-labs/vellum/commit/e5c72f131e18fb1819bf13209bf1c5e293591310) Thanks [@kmelve](https://github.com/kmelve)! - An update that sets a list to `[]` now removes the field, the way Studio unsets an emptied array. It used to keep `[]`, which passes Sanity's required rule, so clearing a required list came back without an error. It now reports `Required`.

## 0.2.0

### Minor Changes

- [#3](https://github.com/sanity-labs/vellum/pull/3) [`e8e5f49`](https://github.com/sanity-labs/vellum/commit/e8e5f4957d05f67a6abad4457d806f699973a193) Thanks [@kmelve](https://github.com/kmelve)! - `convertDocument` results include `evidence`, keyed by field path like `confidence`. Each entry says whether the field was filled or left empty and why: the source block and exact text a value was copied from, the probability of each answer Jev gave to "which part of the source supplies this field?", and the signals that accepted it.

- [#3](https://github.com/sanity-labs/vellum/pull/3) [`e8e5f49`](https://github.com/sanity-labs/vellum/commit/e8e5f4957d05f67a6abad4457d806f699973a193) Thanks [@kmelve](https://github.com/kmelve)! - The server reaches Jev through OpenRouter when `OPENROUTER_API_KEY` is set, and through TypeSafe with `TYPESAFE_API_KEY` as before. OpenRouter wins when both are set.

- [#7](https://github.com/sanity-labs/vellum/pull/7) [`7ce056c`](https://github.com/sanity-labs/vellum/commit/7ce056c60c69ebb6961b39d574a8c48bd3417045) Thanks [@kmelve](https://github.com/kmelve)! - Arrays of plain values, like a list of tags, fill from one line. `Tags: React, Open source` becomes `['React', 'Open source']`. The line is split on commas or semicolons, and every item has to fit the item type, including any predefined values. JSON Schema and Zod arrays of one plain type are no longer reported as unmapped, and **Apply changes** replaces the list when its line changes. The blog post starter has a `tags` field to show it.

- [#9](https://github.com/sanity-labs/vellum/pull/9) [`a1a3ab4`](https://github.com/sanity-labs/vellum/commit/a1a3ab4b7bc87bf4f16003d34565ce0565e0209c) Thanks [@RostiMelk](https://github.com/RostiMelk)! - Stream the document while it's being mapped. `onProgress` now also receives `draft` events with the partial document: fields as soon as they're confirmed, and page sections one at a time.

### Patch Changes

- [#3](https://github.com/sanity-labs/vellum/pull/3) [`e8e5f49`](https://github.com/sanity-labs/vellum/commit/e8e5f4957d05f67a6abad4457d806f699973a193) Thanks [@kmelve](https://github.com/kmelve)! - URL fields only take `http(s)`, `mailto` and `tel` links or relative paths, so labeled lines like `Venue: Oslo` are no longer offered as URLs. A missing required value reports `Required` once instead of failing every rule on its path, and validation messages name array items by index (`items[0].title`) instead of by `_key`.

## 0.1.0

### Minor Changes

- [#1](https://github.com/sanity-labs/vellum/pull/1) [`1ace0af`](https://github.com/sanity-labs/vellum/commit/1ace0afb1927b51b6dbdd226cc2629daa9f67c47) Thanks [@RostiMelk](https://github.com/RostiMelk)! - First release. `@sanity-labs/vellum` is a browser client for a Vellum server, and `@sanity-labs/vellum/server` is the request handler that runs the mapping.
