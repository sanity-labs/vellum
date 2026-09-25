import { button, defineType, required } from './define'

export const landingPage = defineType({
  name: 'landingPage',
  type: 'document',
  title: 'Landing page',
  fields: [
    { name: 'title', type: 'string', validation: required },
    { name: 'slug', type: 'slug' },
    { name: 'seoTitle', title: 'SEO title', type: 'string' },
    { name: 'seoDescription', title: 'SEO description', type: 'text' },
    {
      name: 'sections',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'hero',
          fields: [
            { name: 'eyebrow', type: 'string' },
            { name: 'heading', type: 'string', validation: required },
            { name: 'description', type: 'text' },
            {
              name: 'layout',
              type: 'string',
              options: { list: ['left', 'centered'] },
            },
            { name: 'actions', type: 'array', of: [button] },
          ],
        },
        {
          type: 'object',
          name: 'features',
          fields: [
            { name: 'heading', type: 'string' },
            { name: 'description', type: 'text' },
            {
              name: 'items',
              type: 'array',
              of: [
                {
                  type: 'object',
                  name: 'feature',
                  fields: [
                    { name: 'title', type: 'string', validation: required },
                    { name: 'body', type: 'text' },
                    { name: 'actions', type: 'array', of: [button] },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'object',
          name: 'cards',
          fields: [
            { name: 'heading', type: 'string' },
            { name: 'description', type: 'text' },
            {
              name: 'items',
              type: 'array',
              of: [
                {
                  type: 'object',
                  name: 'card',
                  fields: [
                    { name: 'title', type: 'string', validation: required },
                    { name: 'body', type: 'text' },
                    { name: 'linkLabel', type: 'string' },
                    { name: 'url', type: 'url' },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'object',
          name: 'testimonial',
          fields: [
            { name: 'eyebrow', type: 'string' },
            { name: 'heading', type: 'string' },
            {
              name: 'quote',
              type: 'text',
              description: 'The customer’s words, verbatim.',
              validation: required,
            },
            { name: 'author', type: 'string', validation: required },
          ],
        },
        {
          type: 'object',
          name: 'faq',
          title: 'FAQ',
          fields: [
            { name: 'heading', type: 'string' },
            {
              name: 'questions',
              type: 'array',
              of: [
                {
                  type: 'object',
                  name: 'question',
                  fields: [
                    { name: 'question', type: 'string', validation: required },
                    { name: 'answer', type: 'text', validation: required },
                  ],
                },
              ],
            },
            { name: 'footer', type: 'string' },
          ],
        },
        {
          type: 'object',
          name: 'callToAction',
          title: 'Call to action',
          fields: [
            { name: 'eyebrow', type: 'string' },
            { name: 'heading', type: 'string', validation: required },
            { name: 'description', type: 'text' },
            { name: 'actions', type: 'array', of: [button] },
            {
              name: 'theme',
              type: 'string',
              options: { list: ['default', 'inverted'] },
            },
          ],
        },
      ],
    },
  ],
})
