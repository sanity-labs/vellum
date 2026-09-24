import { defineType, required, richText } from './define'

export const recipe = defineType({
  name: 'recipe',
  type: 'document',
  title: 'Recipe',
  fields: [
    { name: 'title', type: 'string', validation: required },
    { name: 'description', type: 'text' },
    { name: 'servings', type: 'number', validation: (rule) => rule.min(1) },
    { name: 'prepMinutes', title: 'Prep time (minutes)', type: 'number' },
    { name: 'cookMinutes', title: 'Cook time (minutes)', type: 'number' },
    {
      name: 'difficulty',
      type: 'string',
      options: { list: ['Easy', 'Medium', 'Hard'] },
    },
    { name: 'cuisine', type: 'string' },
    { name: 'ingredients', ...richText, validation: required },
    { name: 'method', ...richText, validation: required },
  ],
})
