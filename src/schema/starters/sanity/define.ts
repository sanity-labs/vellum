import type { TypeDefinition } from '../../descriptor'

export type Rule = { required(): Rule; min(value: number): Rule; max(value: number): Rule }
type Field = {
  name: string
  type: string
  title?: string
  description?: string
  validation?: (rule: Rule) => Rule
  options?: { list: string[] }
  fields?: Field[]
  of?: ({ type: string } | Field)[]
}

/**
 * Stands in for `defineType` from `sanity`, so the starters read like Studio code and stay
 * plain JavaScript once the imports are gone. That's what lets the editor run them.
 */
export const defineType = (definition: Field) => definition as unknown as TypeDefinition

export const required = (rule: Rule) => rule.required()
export const richText = { type: 'array', of: [{ type: 'block' }] }
export const button: Field = {
  type: 'object',
  name: 'button',
  title: 'Button',
  fields: [
    { name: 'label', type: 'string', validation: required },
    { name: 'url', type: 'url', validation: required },
  ],
}
