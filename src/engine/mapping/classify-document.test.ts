import { afterEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { createSchema } from '../schema/registry'
import { classifyDocument } from './classify-document'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const signal = () => new AbortController().signal

test('classifies with schema purpose and field titles without inventing descriptions or repeating boilerplate', async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  const source = '# Product notes\n\nA product story with a code example.'
  const documents = ['post', 'article', 'tutorial', 'guide'].map((name) => ({
    name,
    title: name === 'post' ? 'Blog post' : name,
    description: name === 'article' ? 'Official reference documentation.' : '',
    fields: [
      { name: 'seo', title: 'SEO', type: 'string', description: 'Shown in search results.' },
      { name: 'body', title: 'Main content', type: 'array', description: '' },
      ...(name === 'post'
        ? [
            {
              name: 'publishedAt',
              title: 'Published',
              type: 'date',
              description: 'Blog feed date.',
            },
          ]
        : []),
    ],
  }))
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = z
      .object({
        state: z.object({ title: z.string(), source: z.string() }),
        questions: z.object({
          documentType: z.object({ criteria: z.record(z.string(), z.string()) }),
        }),
      })
      .parse(JSON.parse(String(init.body)))
    expect(body.state).toEqual({ title: 'Product notes', source })
    const criteria = body.questions.documentType.criteria
    expect(criteria.post).toContain('Title: Blog post')
    expect(criteria.post).toContain('body [Main content]')
    expect(criteria.post).toContain('Blog feed date.')
    expect(criteria.post).not.toContain('Description:')
    expect(criteria.article).toContain('Description: Official reference documentation.')
    expect(JSON.stringify(criteria)).not.toContain('Shown in search results.')
    return Response.json({
      model: 'jev-test',
      usage: { input_tokens: 100, output_tokens: 0 },
      answers: { documentType: { choice: 'post', confidence: 0.6, probabilities: { post: 0.7 } } },
    })
  })
  const registry = createSchema({
    types: Object.fromEntries(
      documents.map((document) => [
        document.name,
        {
          extends: 'document',
          title: document.title,
          description: document.description,
          fields: document.fields.map((field) => ({
            name: field.name,
            typeDef: {
              extends: field.type,
              title: field.title,
              description: field.description,
            },
          })),
        },
      ]),
    ),
  })
  const result = await classifyDocument(source, registry, signal())
  expect(result.choice).toBe('post')
  expect(result.confidence).toBe(0.6)
})
