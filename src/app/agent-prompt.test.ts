import { expect, test } from 'vitest'
import { starterCode, starters } from '../schema/starters'
import * as define from '../schema/starters/sanity/define'
import { agentPrompt, defineHelpers, sanityNewPrompt } from './agent-prompt'

const documentType = {
  name: 'post',
  title: 'Blog post',
  fields: [
    { name: 'title', title: 'Title', type: 'string', description: '' },
    { name: 'excerpt', title: 'Excerpt', type: 'text', description: 'One or two sentences.' },
  ],
}
const document = { _type: 'post', title: 'The logo soup problem' }

test('opens with the sanity.new prompt and carries the document', () => {
  const prompt = agentPrompt({ document, documentType, errors: [] })
  expect(prompt.startsWith(sanityNewPrompt)).toBe(true)
  expect(prompt).toContain('named `post`')
  expect(prompt).toContain(JSON.stringify(document, null, 2))
  expect(prompt).not.toContain('## Validation')
})

test('explains the helpers a Sanity starter imports from ./define', () => {
  const starter = starters.find((item) => item.id === 'landing-page')
  if (!starter) throw new Error('Missing landing page starter')
  const code = starterCode(starter, 'sanity')
  const prompt = agentPrompt({
    document,
    documentType,
    schema: { format: 'sanity', code },
    errors: [],
  })
  expect(prompt).toContain(code.trim())
  expect(prompt).toContain(defineHelpers.button)
  expect(prompt).toContain(defineHelpers.required)
  expect(prompt).not.toContain(defineHelpers.richText)
})

test('describes every helper the starters can import', () => {
  expect(Object.keys(define).sort()).toEqual(Object.keys(defineHelpers).sort())
})

test('asks for a Sanity type from Zod and JSON Schema', () => {
  const zod = agentPrompt({
    document,
    documentType,
    schema: { format: 'zod', code: 'export const Post = z.object({})' },
    errors: [],
  })
  expect(zod).toContain('A Zod schema. Write it as a Sanity schema type.')
  const json = agentPrompt({
    document,
    documentType,
    schema: { format: 'json-schema', code: '{ "type": "object" }' },
    errors: [],
  })
  expect(json).toContain('```json\n{ "type": "object" }\n```')
})

test('lists fields when the schema was a pasted descriptor', () => {
  const prompt = agentPrompt({ document, documentType, errors: [] })
  expect(prompt).toContain('- `title` (string)\n- `excerpt` (text): One or two sentences.')
})

test('passes validation errors on instead of asking the agent to fill them', () => {
  const prompt = agentPrompt({ document, documentType, errors: ['body: Required'] })
  expect(prompt).toContain(
    "## Validation\n\nSanity validation flagged these. Don't fill the fields in.",
  )
  expect(prompt).toContain('- body: Required')
})
