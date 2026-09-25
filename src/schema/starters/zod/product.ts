import { z } from 'zod'

export const Product = z
  .object({
    name: z.string().min(1),
    sku: z.string().optional().meta({ title: 'SKU' }),
    price: z.number().min(0),
    currency: z.enum(['USD', 'EUR', 'GBP', 'NOK']).optional(),
    inStock: z.boolean().optional(),
    tagline: z.string().optional().describe('A short line under the name.'),
    description: z.string().meta({ format: 'markdown' }).optional(),
    specs: z.string().meta({ format: 'markdown' }).optional(),
    buyUrl: z.url().optional(),
  })
  .meta({ title: 'Product' })
