import { z } from 'zod'
import blogPostSource from '../examples/starters/blog-post.md?raw'
import eventSource from '../examples/starters/event.md?raw'
import jobSource from '../examples/starters/job-posting.md?raw'
import landingPageSource from '../examples/starters/landing-page.md?raw'
import productSource from '../examples/starters/product.md?raw'
import recipeSource from '../examples/starters/recipe.md?raw'
import { type CompiledSchema, compileSchemaCode, type SchemaFormat } from './code'
import blogPostSanity from './starters/sanity/blog-post.ts?raw'
import eventSanity from './starters/sanity/event.ts?raw'
import jobPostingSanity from './starters/sanity/job-posting.ts?raw'
import landingPageSanity from './starters/sanity/landing-page.ts?raw'
import productSanity from './starters/sanity/product.ts?raw'
import recipeSanity from './starters/sanity/recipe.ts?raw'
import blogPostZod from './starters/zod/blog-post.ts?raw'
import eventZod from './starters/zod/event.ts?raw'
import jobPostingZod from './starters/zod/job-posting.ts?raw'
import landingPageZod from './starters/zod/landing-page.ts?raw'
import productZod from './starters/zod/product.ts?raw'
import recipeZod from './starters/zod/recipe.ts?raw'

export type { SchemaFormat }
export const schemaFormats: { value: SchemaFormat; label: string }[] = [
  { value: 'sanity', label: 'Sanity' },
  { value: 'zod', label: 'Zod' },
  { value: 'json-schema', label: 'JSON Schema' },
]

export type Starter = {
  id: string
  title: string
  description: string
  source: string
  /** Source code per format, what the editor starts from. */
  code: { sanity: string; zod: string }
}

/** Small schemas people recognize, each written for Sanity and for Zod, with a source to try. */
export const starters: Starter[] = [
  {
    id: 'blog-post',
    title: 'Blog post',
    description: 'Title, excerpt, author, category, body',
    source: blogPostSource,
    code: { sanity: blogPostSanity, zod: blogPostZod },
  },
  {
    id: 'product',
    title: 'Product',
    description: 'Name, price, stock, specs, description',
    source: productSource,
    code: { sanity: productSanity, zod: productZod },
  },
  {
    id: 'event',
    title: 'Event',
    description: 'Dates, venue, format, speakers, agenda',
    source: eventSource,
    code: { sanity: eventSanity, zod: eventZod },
  },
  {
    id: 'job-posting',
    title: 'Job posting',
    description: 'Role, location, salary range, responsibilities',
    source: jobSource,
    code: { sanity: jobPostingSanity, zod: jobPostingZod },
  },
  {
    id: 'recipe',
    title: 'Recipe',
    description: 'Servings, timings, ingredients, method',
    source: recipeSource,
    code: { sanity: recipeSanity, zod: recipeZod },
  },
  {
    id: 'landing-page',
    title: 'Landing page',
    description: 'Hero, features, cards, quote, FAQ, call to action',
    source: landingPageSource,
    code: { sanity: landingPageSanity, zod: landingPageZod },
  },
]

/** A starter's source in one format. JSON Schema is what `z.toJSONSchema()` makes of the Zod. */
export function starterCode(starter: Starter, format: SchemaFormat) {
  if (format !== 'json-schema') return starter.code[format]
  const { zod } = compileSchemaCode('zod', starter.code.zod)
  return `${JSON.stringify(z.toJSONSchema(zod as z.ZodType), null, 2)}\n`
}

export function starterSchema(starter: Starter, format: SchemaFormat): CompiledSchema {
  return compileSchemaCode(format, starterCode(starter, format))
}
