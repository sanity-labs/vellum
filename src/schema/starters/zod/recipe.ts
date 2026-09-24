import { z } from 'zod'

export const Recipe = z
  .object({
    title: z.string().min(1),
    description: z.string().max(500).optional(),
    servings: z.number().min(1).optional(),
    prepMinutes: z.number().min(0).optional(),
    cookMinutes: z.number().min(0).optional(),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
    cuisine: z.string().optional(),
    ingredients: z.string().meta({ format: 'markdown' }),
    method: z.string().meta({ format: 'markdown' }),
  })
  .meta({ title: 'Recipe' })
