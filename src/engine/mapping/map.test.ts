import { afterEach, expect, test, vi } from 'vitest'
import { documentRunRequest, documentRunResponse } from '../../shared/contracts'
import { runDocument } from '../document/pipeline'
import { fakeJev } from '../jev/fake'
import { createSchema, defaultSchema } from '../schema/registry'
import { mapBlocks } from './map'

const signal = () => new AbortController().signal
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const source = `# Atlas for teams

Slug: /atlas-for-teams

Plan together. Deliver with confidence.

## Opening hero

Keep context close and ownership clear.

[Book a walkthrough](https://example.com/atlas/demo)

[Explore the workflow](/atlas/workflow)

## Questions

### Can we start with one team?

Yes. Start with a single workflow.

### Can we export our work?

Yes. Plans export as JSON.
`

test('maps headings, labeled values, links and nested sections into the bundled landing page schema', async () => {
  const requests = fakeJev({
    singlePassages: ['title'],
    assign: {
      B000: ['title'],
      'B001.value': ['slug'],
      B002: ['description'],
      B003: ['content', 'title'],
      B004: ['content', 'description'],
      B005: ['content', 'ctas'],
      'B005.text': ['content', 'ctas', 'label'],
      'B005.href': ['content', 'ctas', 'url'],
      B006: ['content', 'ctas'],
      'B006.text': ['content', 'ctas', 'label'],
      'B006.href': ['content', 'ctas', 'url'],
      B007: ['content', 'title'],
      B008: ['content', 'questions', 'question'],
      B009: ['content', 'questions', 'answer'],
      B010: ['content', 'questions', 'question'],
      B011: ['content', 'questions', 'answer'],
    },
    boundaries: { ctas: ['B006'], questions: ['B010'] },
    members: { B003: 'heroPageBlock', B007: 'faqPageBlock' },
  })
  const result = documentRunResponse.parse(
    await runDocument(documentRunRequest.parse({ source, documentType: 'landingPage' }), signal()),
  )
  expect(result.document).toMatchObject({
    _type: 'landingPage',
    title: 'Atlas for teams',
    slug: { _type: 'slug', current: 'atlas-for-teams' },
    description: 'Plan together. Deliver with confidence.',
    content: [
      {
        _type: 'heroPageBlock',
        title: [{ _type: 'block', children: [{ text: 'Opening hero' }] }],
        description: 'Keep context close and ownership clear.',
        ctas: [
          { _type: 'button', label: 'Book a walkthrough', url: 'https://example.com/atlas/demo' },
          { _type: 'button', label: 'Explore the workflow', url: '/atlas/workflow' },
        ],
      },
      {
        _type: 'faqPageBlock',
        title: 'Questions',
        questions: [
          {
            _type: 'faqQuestion',
            question: 'Can we start with one team?',
            answer: [
              { _type: 'block', children: [{ text: 'Yes. Start with a single workflow.' }] },
            ],
          },
          { _type: 'faqQuestion', question: 'Can we export our work?' },
        ],
      },
    ],
  })
  expect(result.trace.every((step) => step.engine === 'Classifier' || step.engine === 'Code')).toBe(
    true,
  )
  expect(requests.length).toBeGreaterThan(3)
})

test('keeps unconfirmed values out of the document and reports them instead of guessing', async () => {
  fakeJev({ assign: { B001: ['text'], B002: ['text'] } })
  const { document, notes } = await mapBlocks(
    {
      source: '# Not a title\n\nA paragraph.\n\nAnother paragraph.',
      registry: defaultSchema,
      typeName: 'post',
      threshold: 0.7,
    },
    signal(),
  )
  expect(document.title).toBeUndefined()
  expect(document.text).toBe('A paragraph.\n\nAnother paragraph.')
  expect(notes).toContain('Unconsumed blocks: B000')
})

test('copies a value verbatim only when two signals agree, and never invents a required field', async () => {
  fakeJev({ assign: { B000: ['title'], B001: ['text'] } })
  const registry = createSchema({
    types: {
      note: {
        extends: 'document',
        fields: [
          { name: 'title', typeDef: { extends: 'string' } },
          {
            name: 'author',
            typeDef: { extends: 'string', validation: [{ rules: [{ type: 'required' }] }] },
          },
          {
            name: 'text',
            typeDef: { extends: 'array', of: [{ name: 'block', typeDef: { extends: 'block' } }] },
          },
        ],
      },
    },
  })
  const result = await runDocument(
    documentRunRequest.parse({
      source: '# Hello\n\nBody.',
      schema: JSON.stringify(registry.descriptor),
      documentType: 'note',
    }),
    signal(),
  )
  expect(result.document).toMatchObject({ title: 'Hello' })
  expect(result.document?.author).toBeUndefined()
  expect(result.errors).toContain('author: Required')
})

test('prefers the value after a label over the whole labeled line', async () => {
  fakeJev({ assign: { B000: ['title'], 'B000.value': ['title'], B001: ['text'] } })
  const { document } = await mapBlocks(
    {
      source: 'Title: Hello world\n\nBody.',
      registry: defaultSchema,
      typeName: 'post',
      threshold: 0.7,
    },
    signal(),
  )
  expect(document.title).toBe('Hello world')
})
