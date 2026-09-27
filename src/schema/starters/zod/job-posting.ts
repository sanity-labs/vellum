import { z } from 'zod'

export const JobPosting = z
  .object({
    title: z.string().min(1),
    team: z.string().optional(),
    location: z.string().optional(),
    workplace: z.enum(['Remote', 'Hybrid', 'On-site']).optional(),
    employmentType: z.enum(['Full-time', 'Part-time', 'Contract', 'Internship']).optional(),
    salaryMin: z.number().min(0).optional(),
    salaryMax: z.number().min(0).optional(),
    applyUrl: z.url(),
    summary: z.string().max(400).optional(),
    responsibilities: z.string().meta({ format: 'markdown' }).optional(),
    requirements: z.string().meta({ format: 'markdown' }).optional(),
  })
  .meta({ title: 'Job posting' })
