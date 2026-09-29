/* ──────────────────────────────────────────────
   ORVIA — Central demo profile configuration
   All values are completely synthetic.
   ────────────────────────────────────────────── */

import type { DemoProfile } from './types';

export const demoProfile: DemoProfile = {
  fullName: 'Manan Bharti',
  email: 'manan.demo@orvia.ai',
  phone: '9876543210',
  college: 'Thapar Polytechnic',
  course: 'Diploma in Computer Science',
  year: '1st Year',
  role: 'Full Stack Intern',
  skills: ['React', 'TypeScript', 'Python', 'FastAPI'],
  github: 'https://github.com/orvia-demo',
  portfolio: 'https://orvia-demo.example',
  resumeLink: '',
  coverNote:
    'I enjoy building reliable, privacy-first software and would love to contribute to this role.',
  consent: true,
};

/* ──────────────────────────────────────────────
   Fuzzy label → profile key mapping
   Normalises both the label and the key before comparison.
   Order matters: more specific patterns are checked first.
   ────────────────────────────────────────────── */

type MapEntry = { patterns: RegExp; key: keyof DemoProfile };

const labelMap: MapEntry[] = [
  { patterns: /full\s*name|your\s*name|^name$|applicant\s*name|candidate\s*name/i, key: 'fullName' },
  { patterns: /e[-.]?mail/i, key: 'email' },
  { patterns: /phone|mobile|contact|tel/i, key: 'phone' },
  { patterns: /college|university|institution|institute|school|campus/i, key: 'college' },
  { patterns: /program|course|degree|branch|stream|major|department/i, key: 'course' },
  { patterns: /year\s*of\s*study|current\s*year|graduation\s*year|^year$/i, key: 'year' },
  { patterns: /role\s*apply|position|role|designation|job\s*title|applying\s*for/i, key: 'role' },
  { patterns: /skill|tech|stack|language|framework/i, key: 'skills' },
  { patterns: /github|git\s*hub/i, key: 'github' },
  { patterns: /portfolio|website|personal\s*site|url/i, key: 'portfolio' },
  { patterns: /resume|cv|curriculum/i, key: 'resumeLink' },
  { patterns: /cover\s*note|cover\s*letter|motivation|about\s*you|why|sop|statement/i, key: 'coverNote' },
  { patterns: /consent|agree|accept|terms|confirm|declaration/i, key: 'consent' },
];

/** Given a visible field label, return the matching profile key or '' */
export function matchLabel(label: string): keyof DemoProfile | '' {
  const norm = label.replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
  for (const { patterns, key } of labelMap) {
    if (patterns.test(norm)) return key;
  }
  return '';
}

/** Resolve a profile key to the string value to insert */
export function resolveValue(profile: DemoProfile, key: keyof DemoProfile): string {
  const val = profile[key];
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return String(val);
}
