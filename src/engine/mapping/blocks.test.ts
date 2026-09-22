import { expect, test } from 'vitest'
import { splitBlocks } from './blocks'

const source = `# Community Digest: Summer Edition

Slug: /digest

- one
- Label: two
  continued

> A quote

\`\`\`js
code

# not a heading
\`\`\`

![alt](https://example.com/a.png)

[Book a demo](https://example.com/demo)

Setext
===

| a | b |
|---|---|
| 1 | 2 |

---

<div>html</div>

1. first
2. second
`

test('splits Markdown into parser-defined blocks and offers label and link parts only where they can exist', () => {
  const blocks = splitBlocks(source)
  expect(blocks.map((block) => [block.kind, block.level, block.content])).toEqual([
    ['heading', 1, 'Community Digest: Summer Edition'],
    ['paragraph', undefined, 'Slug: /digest'],
    ['list item', undefined, 'one'],
    ['list item', undefined, 'Label: two\n  continued'],
    ['quote', undefined, '> A quote'],
    ['code', undefined, '```js\ncode\n\n# not a heading\n```'],
    ['image', undefined, '![alt](https://example.com/a.png)'],
    ['paragraph', undefined, '[Book a demo](https://example.com/demo)'],
    ['heading', 1, 'Setext'],
    ['table', undefined, '| a | b |\n|---|---|\n| 1 | 2 |'],
    ['rule', undefined, '---'],
    ['html', undefined, '<div>html</div>'],
    ['list item', undefined, 'first'],
    ['list item', undefined, 'second'],
  ])
  const parts = Object.fromEntries(
    blocks.flatMap((block) =>
      block.spans.filter((span) => span.id !== block.id).map((span) => [span.id, span.text]),
    ),
  )
  expect(parts).toEqual({
    'B001.value': '/digest',
    'B007.text': 'Book a demo',
    'B007.href': 'https://example.com/demo',
  })
  expect(blocks.filter((block) => !block.spans.length).map((block) => block.kind)).toEqual([
    'code',
    'image',
    'rule',
    'html',
  ])
})
