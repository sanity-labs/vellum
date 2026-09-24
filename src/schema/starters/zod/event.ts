import { z } from 'zod'

export const Event = z
  .object({
    title: z.string().min(1),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    format: z.enum(['In person', 'Online', 'Hybrid']).optional(),
    venue: z.string().optional(),
    city: z.string().optional(),
    price: z.number().min(0).optional(),
    registrationUrl: z.url().optional(),
    description: z.string().meta({ format: 'markdown' }).optional(),
    speakers: z
      .array(
        z
          .object({ name: z.string(), role: z.string().optional(), company: z.string().optional() })
          .meta({ title: 'Speaker' }),
      )
      .optional(),
    agenda: z
      .array(
        z.object({ time: z.string().optional(), title: z.string() }).meta({ title: 'Session' }),
      )
      .optional(),
  })
  .meta({ title: 'Event' })
