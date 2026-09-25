import { defineType, required, richText } from './define'

export const blogPost = defineType({
  name: 'post',
  type: 'document',
  title: 'Blog post',
  fields: [
    { name: 'title', type: 'string', validation: (rule) => rule.required().max(120) },
    { name: 'slug', type: 'slug' },
    {
      name: 'excerpt',
      type: 'text',
      description: 'One or two sentences that sell the post.',
      validation: (rule) => rule.max(300),
    },
    { name: 'author', type: 'string' },
    { name: 'publishedAt', type: 'datetime' },
    {
      name: 'category',
      type: 'string',
      options: { list: ['Engineering', 'Design', 'Product', 'Company', 'Tutorial'] },
    },
    { name: 'body', title: 'Body', ...richText, validation: required },
  ],
})
