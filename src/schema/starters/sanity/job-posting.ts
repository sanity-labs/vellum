import { defineType, required, richText } from './define'

export const jobPosting = defineType({
  name: 'jobPosting',
  type: 'document',
  title: 'Job posting',
  fields: [
    { name: 'title', type: 'string', validation: required },
    { name: 'team', type: 'string' },
    { name: 'location', type: 'string' },
    {
      name: 'workplace',
      type: 'string',
      options: { list: ['Remote', 'Hybrid', 'On-site'] },
    },
    {
      name: 'employmentType',
      title: 'Employment type',
      type: 'string',
      options: { list: ['Full-time', 'Part-time', 'Contract', 'Internship'] },
    },
    { name: 'salaryMin', title: 'Salary from', type: 'number' },
    { name: 'salaryMax', title: 'Salary to', type: 'number' },
    { name: 'applyUrl', title: 'Apply URL', type: 'url', validation: required },
    { name: 'summary', type: 'text', validation: (rule) => rule.max(400) },
    { name: 'responsibilities', ...richText },
    { name: 'requirements', ...richText },
  ],
})
