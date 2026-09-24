import { defineType, required, richText } from './define'

export const event = defineType({
  name: 'event',
  type: 'document',
  title: 'Event',
  fields: [
    { name: 'title', type: 'string', validation: required },
    { name: 'startsAt', title: 'Starts at', type: 'datetime', validation: required },
    { name: 'endsAt', title: 'Ends at', type: 'datetime' },
    {
      name: 'format',
      type: 'string',
      options: { list: ['In person', 'Online', 'Hybrid'] },
    },
    { name: 'venue', type: 'string' },
    { name: 'city', type: 'string' },
    { name: 'price', type: 'number', validation: (rule) => rule.min(0) },
    { name: 'registrationUrl', title: 'Registration URL', type: 'url' },
    { name: 'description', ...richText },
    {
      name: 'speakers',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'speaker',
          fields: [
            { name: 'name', type: 'string', validation: required },
            { name: 'role', type: 'string' },
            { name: 'company', type: 'string' },
          ],
        },
      ],
    },
    {
      name: 'agenda',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'session',
          fields: [
            { name: 'time', type: 'string' },
            { name: 'title', type: 'string', validation: required },
          ],
        },
      ],
    },
  ],
})
