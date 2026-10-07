import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { FieldEvidence } from '../shared/contracts'
import { DocumentPreview } from './DocumentPreview'

const empty = (reason: FieldEvidence['reason']): FieldEvidence => ({
  status: 'empty',
  reason,
  options: [],
})

test('a required field with no value reads as Required, not as left empty', () => {
  const html = renderToStaticMarkup(
    <DocumentPreview
      value={{
        _type: 'product',
        name: 'Trail Pack',
        sections: [{ _type: 'signup', _key: 'a', title: 'Sign up' }],
      }}
      required={new Set(['price', 'author', 'sections[0].form'])}
      inspect={{
        evidence: { price: empty('no-candidates'), tagline: empty('none-chosen') },
        onSelect: () => {},
        onShowSource: () => {},
      }}
    />,
  )
  const field = (name: string) => html.match(new RegExp(`${name}.*?</dd>`))?.[0] ?? ''
  expect(field('Price')).toContain('Required')
  expect(field('Tagline')).toContain('Left empty')
  // Vellum never looks for references, so only validation knows this one is missing.
  expect(field('Author')).toContain('Required')
  expect(field('Form')).toContain('Required')
  expect(field('Name')).not.toContain('Required')
})
