import { defineType, required, richText } from './define'

export const product = defineType({
  name: 'product',
  type: 'document',
  title: 'Product',
  fields: [
    { name: 'name', type: 'string', validation: required },
    { name: 'sku', title: 'SKU', type: 'string' },
    { name: 'price', type: 'number', validation: (rule) => rule.required().min(0) },
    { name: 'currency', type: 'string', options: { list: ['USD', 'EUR', 'GBP', 'NOK'] } },
    { name: 'inStock', title: 'In stock', type: 'boolean' },
    { name: 'tagline', type: 'string', description: 'A short line under the name.' },
    { name: 'description', ...richText },
    {
      name: 'specs',
      title: 'Specifications',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'spec',
          title: 'Specification',
          fields: [
            { name: 'label', type: 'string', validation: required },
            { name: 'value', type: 'string', validation: required },
          ],
        },
      ],
    },
    { name: 'buyUrl', title: 'Buy URL', type: 'url' },
  ],
})
