import { z } from 'zod'

export const BlogPost = z
  .object({
    title: z.string().min(1).max(120),
    slug: z.string().optional(),
    excerpt: z.string().max(300).optional().describe('One or two sentences that sell the post.'),
    author: z.string().optional(),
    publishedAt: z.iso.datetime({ offset: true }).optional(),
    category: z.enum(['Engineering', 'Design', 'Product', 'Company', 'Tutorial']).optional(),
    body: z.string().meta({ format: 'markdown' }),
  })
  .meta({ title: 'Blog post' })
