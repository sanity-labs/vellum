import { z } from 'zod'

const Button = z.object({ label: z.string(), url: z.url() }).meta({ title: 'Button' })

const Hero = z.object({
  type: z.literal('hero'),
  eyebrow: z.string().optional(),
  heading: z.string(),
  description: z.string().max(500).optional(),
  layout: z.enum(['left', 'centered']).optional(),
  actions: z.array(Button).optional(),
})

const Features = z.object({
  type: z.literal('features'),
  heading: z.string().optional(),
  description: z.string().max(500).optional(),
  items: z
    .array(
      z
        .object({
          title: z.string(),
          body: z.string().max(500).optional(),
          actions: z.array(Button).optional(),
        })
        .meta({ title: 'Feature' }),
    )
    .optional(),
})

const Cards = z.object({
  type: z.literal('cards'),
  heading: z.string().optional(),
  description: z.string().max(500).optional(),
  items: z
    .array(
      z
        .object({
          title: z.string(),
          body: z.string().max(500).optional(),
          linkLabel: z.string().optional(),
          url: z.url().optional(),
        })
        .meta({ title: 'Card' }),
    )
    .optional(),
})

const Testimonial = z.object({
  type: z.literal('testimonial'),
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  quote: z.string().max(500).describe('The customer’s words, verbatim.'),
  author: z.string(),
})

const Faq = z.object({
  type: z.literal('faq'),
  heading: z.string().optional(),
  questions: z
    .array(
      z.object({ question: z.string(), answer: z.string().max(1000) }).meta({ title: 'Question' }),
    )
    .optional(),
  footer: z.string().optional(),
})

const CallToAction = z.object({
  type: z.literal('callToAction'),
  eyebrow: z.string().optional(),
  heading: z.string(),
  description: z.string().max(500).optional(),
  actions: z.array(Button).optional(),
  theme: z.enum(['default', 'inverted']).optional(),
})

export const LandingPage = z
  .object({
    title: z.string().min(1),
    slug: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().max(500).optional(),
    sections: z
      .array(z.discriminatedUnion('type', [Hero, Features, Cards, Testimonial, Faq, CallToAction]))
      .optional(),
  })
  .meta({ title: 'Landing page' })
