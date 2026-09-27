import { defineType, required, richText } from './define'

export const recipe = defineType({
  name: 'recipe',
  type: 'document',
  title: 'Recipe',
  fields: [
    { name: 'title', type: 'string', validation: required },
    { name: 'description', type: 'text' },
    { name: 'servings', type: 'number', validation: (rule) => rule.min(1) },
    { name: 'prepTime', title: 'Prep time', type: 'string' },
    { name: 'cookTime', title: 'Cook time', type: 'string' },
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
