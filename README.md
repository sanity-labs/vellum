# Vellum

Paste this into [vellum.sanity.build](https://vellum.sanity.build):

```markdown
# The logo soup problem

Why do logo clouds always look like a ransom note? A deep dive into the math
behind making mismatched brand logos actually look good together.

You know the scenario. Marketing sends over a folder labeled "Partner Logos
Final FINAL v3." Inside: a chaotic mix of file formats...
```

Somewhere in the next three seconds, [Jev](https://typesafe.ai), TypeSafe's classifier, gets the blocks with ids attached and a question about them:

```json
{
  "state": "B000| # The logo soup problem\nB001| Why do logo clouds always look like a ransom note? A deep dive...\nB002| You know the scenario. Marketing sends over a folder...",
  "questions": {
    "title": {
      "type": "choice",
      "instructions": "Which block supplies the post's title?",
      "criteria": {
        "B000": "a level 1 heading, the heading that opens this document",
        "B001": "a paragraph, block 2 of 47",
        "__none__": "Nothing here supplies this field; it would have to be written or inferred."
      }
    }
  }
}
```

And this comes back:

```json
{ "choice": "B000", "probabilities": { "B000": 0.94, "B001": 0.04, "__none__": 0.02 } }
```

Code copies the heading into `title`, turns the rest into Portable Text with `@portabletext/markdown`, runs `@sanity/validation`, and hands you a `post` document. About 20 requests. Not one word of it was generated.

That's the whole idea. Vellum maps Markdown into a Sanity document, and the only thing with any judgment in the loop is a classifier. Jev answers multiple-choice and yes/no questions about text that code shows it. It can't write a slug that wasn't there, shorten a title it finds too long, or paraphrase a paragraph on the way in, because it can't produce text at all. If the source doesn't contain a value, the best it can do is pick `__none__`. A required field the source never mentions comes back as a validation error, which is what you'd want from a CMS.

> [!WARNING]
> This is an experiment, not a product. Mapping is incomplete on real documents. The API changes without notice. Jev is new enough that the same input can map differently twice in a row. Read the output.

## How it works

Code does anything that can be done to text without understanding it. Jev does everything else. There's one regular expression left in the mapping code, for `Label: value` lines, and Jev is free to ignore its output.

markdown-it (the parser under `@portabletext/markdown`) splits the source into blocks. Headings, paragraphs, list items, quotes, tables, code, images. Each block gets a stable id, and each paragraph offers the parts a field might want on their own: the text after a `Label:`, or the text and target of a link when the line holds exactly one link. A part is only a candidate for a field if it can be copied into that field's type, so `false` can reach a boolean and `/atlas` a slug, and a paragraph of prose can reach neither.

Then Jev is asked about each candidate from three directions. For this part, which field holds it? For this field, which part supplies it? And, only when those two disagree, is this exact pairing right given that the block is, say, a level 2 heading in position 4 of 12? A value is written when two of the three clear a confidence threshold. Asking the same thing three ways is what makes the noise bearable. Any single answer moves by 0.1 to 0.3 between identical runs. Two independent answers agreeing moves a lot less.

Page builders were the hard part: arrays of sections that contain arrays of buttons, features, questions. While values are being bound, Jev also walks the blocks and says, for each one, whether it continues the current run, starts something nested inside it, or starts a sibling. Each run then gets one more question that names a destination and an item type together, `content.heroPageBlock` or `ctas.button`, with the run's shape and position as facts ("1 × a labeled line, 2 × a paragraph, run 3 of 5, and there are 3 runs shaped like this"). Items are mapped the same way as the document, four levels deep. A brief with `Eyebrow:` and `Primary action: Book a walkthrough → https://…` lines and three numbered features comes out as six sections, three complete features with their own buttons, three cards, a FAQ, and two calls to action. Five to seven seconds, around 90 requests.

The thing that mattered most was telling Jev what code already knows. This is the heading that opens the document. This is block 4 of 12. This object is one item inside a bigger one. Adding those facts to the questions moved the title question on the post above from 0.53 to 0.94. Making the model rediscover Markdown syntax from raw text was the biggest single source of wrong answers we found.

Every value that made it in carries the mean of the signals that accepted it, keyed by path, and the UI shows it as a badge, amber under 85%. Values that fell short show up in the notes with their score. The threshold defaults to 70% and there's a slider. A young model's uncertainty belongs in front of the person reviewing the document, so that's where we put it.

## Limitations

The numbers here come from 72 fixtures rendered from real sanity.io documents: eight posts, eight docs articles, eight landing pages, each in three Markdown variants.

A post's `description` is the lede. In Markdown the lede and the first body paragraph look identical, and Jev lands between 0.4 and 0.6 on it. We leave it empty. Lowering the threshold to make that fixture pass would be lying about what Markdown carries.

Titles written as a bare first line, no `#`, map 14 to 18 times out of 57 depending on the run. That spread is the model, and it should shrink as the model improves.

A hero section and a feature spotlight are the same object once you take away the image, and Jev picks the right one about a third of the time on real landing pages. Of the 812 fields nested inside those sections, 297 come out exact, so the segmentation holds up. Type choice is where the loss is.

Depth costs round trips. A flat post takes two to three seconds; a four-level page builder takes five to seven, and 60% of tokens go to the assign questions. We could cut a couple of seconds by mapping item types before the parent's answer arrives, at double the tokens. We'd rather wait for a faster model.

Nothing that isn't in the text gets in. Images stay as URLs, never asset references. References and files are skipped. Custom validators can't run from descriptor JSON.

## Running it

The hosted version at [vellum.sanity.build](https://vellum.sanity.build) needs nothing. To run your own, you need [Node.js](https://nodejs.org/) 22.12+, [pnpm](https://pnpm.io/installation) 12 (`corepack enable pnpm` picks the pinned version), and a TypeSafe API key from the [console](https://console.typesafe.ai). Conversions bill against that key.

```sh
pnpm install
cp .env.example .env   # add TYPESAFE_API_KEY
pnpm dev
```

Open `http://localhost:5173`, pick something under **Examples**, click **Create document**. Edit the Markdown afterwards and **Apply changes** diffs it against the version that produced the document and only re-asks Jev about blocks that are new; existing `_key`s survive. The playground opens on a small starter schema: blog post, product, event, job posting, recipe, or landing page. Each is written three ways, as a Sanity schema type, as Zod, and as the JSON Schema that `z.toJSONSchema()` makes of the Zod, and **Edit schema** lets you change it in place. Sanity and Zod code runs in your browser as plain JavaScript, so leave out type annotations. With Zod or JSON Schema, the **Plain JSON** tab shows the document without Sanity's `_key`s and `_type`s, with rich text as Markdown, and checks it against the Zod schema. Sanity's admin schema (134 document types) is under **Schema** too, and **Your own schema** takes a descriptor or any JSON Schema. `pnpm test` runs offline.

## Using it from code

```sh
pnpm add @sanity-labs/vellum
```

The package has two halves. `@sanity-labs/vellum/server` exports `handleApiRequest`, which takes a `Request` and returns a `Response`, so it mounts in any Node server built on web requests, such as a Next.js route handler or Hono. It reads `TYPESAFE_API_KEY` from the environment. Here it is in `app/api/vellum/[route]/route.ts`:

```ts
import { handleApiRequest } from '@sanity-labs/vellum/server'

export const GET = handleApiRequest
export const POST = handleApiRequest
```

`@sanity-labs/vellum` is the client. It only talks to that handler, so the key never reaches the browser.

```ts
import { createVellum } from '@sanity-labs/vellum'

const vellum = createVellum({ endpoint: '/api/vellum', schema: descriptor })

const result = await vellum.convertDocument(
  { source: markdown, documentType: 'post' },
  { onProgress: (event) => console.log(event), signal },
)
```

`schema` is a schema descriptor, the JSON that `GET https://api.sanity.io/v1/descriptors/schemas/{id}` returns and `@sanity/schema-descriptor-utils` reads. Leave it out to map into the bundled admin schema. Leave out `documentType` and Jev picks one; if it isn't confident, `status` comes back `'needs-type'`, `document` is `null`, and `classification` lists the candidates.

`result.document` has a `_type` and no `_id`, so it can go straight into `client.create()`. Check `result.validation` first: its `markers` are what `@sanity/validation` rejected. `result.confidence` holds the score for each path, and `result.warnings` includes the values that didn't clear `threshold` (0.7 unless you pass one).

When the Markdown changes, send the new source with the previous result:

```ts
const next = await vellum.updateDocument({ source: editedMarkdown, previous: result })
```

Jev is only asked about blocks it hasn't seen, existing `_key`s survive, and `next.patch.mutations` holds `set`, `unset` and `insert` operations against the previous document, so an edit becomes a small patch instead of a replace.

For a single rich-text field, `convertPortableText({ source, target: 'post.text' })` returns just the blocks as `value`, and `updatePortableText` does the same for edits. Targets are `documentType.field`; a `GET` to the handler's `catalog` route lists every one in the bundled schema.

The handler sends no CORS headers, so serve it from the same origin as the page calling it, or call it from your backend with an absolute `endpoint`. Imports of the server entry carry the 1.8 MB admin schema that `schema` falls back to, so keep them out of browser bundles.
