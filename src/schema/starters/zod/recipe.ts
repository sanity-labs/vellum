import { z } from 'zod'

export const Recipe = z
  .object({
    title: z.string().min(1),
    description: z.string().max(500).optional(),
    servings: z.number().min(1).optional(),
    prepTime: z.string().optional(),
    cookTime: z.string().optional(),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
    cuisine: z.string().optional(),
    ingredients: z.string().meta({ format: 'markdown' }),
    method: z.string().meta({ format: 'markdown' }),
  })
  .meta({ title: 'Recipe' })
