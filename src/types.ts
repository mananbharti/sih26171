/* ──────────────────────────────────────────────
   ORVIA — Shared type definitions
   ────────────────────────────────────────────── */

// ── Flows & Phases ──────────────────────────

export type Flow = 'application' | 'summary' | 'form' | 'extract' | 'privacy-scan';

export type Phase =
  | 'idle'
  | 'planning'
  | 'observing'
  | 'perceiving'
  | 'protecting'
  | 'transmitting'
  | 'reasoning'
  | 'validating'
  | 'approval'
  | 'executing'
  | 'verifying'
  | 'replanning'
  | 'complete'
  | 'error'
  | 'cancelled';

// ── Privacy ─────────────────────────────────

export type Finding = { kind: string; token: string; count: number };

// ── Page Observation ────────────────────────

export type FieldType =
  | 'short-answer'
  | 'paragraph'
  | 'email'
  | 'tel'
  | 'dropdown'
  | 'radio'
  | 'checkbox'
  | 'multi-checkbox'
  | 'consent'
  | 'text'
  | 'textarea'
  | 'unknown';

export interface Field {
  handle: string;
  label: string;
  type: FieldType | string;
  key: string;
  options?: string[];           // available options for dropdown/radio/checkbox
  required?: boolean;
}

export interface Snapshot {
  title: string;
  origin: string;
  text: string;
  headings: string[];
  fields: Field[];
  findings: Finding[];
  blocked: number;
  documentId: string;
  observedAt: number;
  isGoogleForm?: boolean;
}

// ── Demo Profile ────────────────────────────
// All values are synthetic.  Never use real personal information.

export interface DemoProfile {
  fullName: string;
  email: string;
  phone: string;
  college: string;
  course: string;
  year: string;
  role: string;
  skills: string[];
  github: string;
  portfolio: string;
  resumeLink: string;
  coverNote: string;
  consent: boolean;
}

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

/** Backwards-compat alias for the simple 4-field profile used by the old sidebar */
export interface Profile {
  name: string;
  email: string;
  phone: string;
  university: string;
}

export const sampleProfile: Profile = {
  name: demoProfile.fullName,
  email: demoProfile.email,
  phone: demoProfile.phone,
  university: demoProfile.college,
};

// ── Privacy Receipt ─────────────────────────

export interface Receipt {
  id: string;
  time: string;
  findings: Finding[];
  blocked: number;
  payload: string;
  bytes: number;
  networkBytes: 0;
  status: 'local-only';
  elapsed: number;
}

// ── Activity log ────────────────────────────

export interface Activity {
  stage: string;
  detail: string;
  boundary: 'Browser' | 'Local planner' | 'Policy';
  time: string;
}

// ── Structured action ───────────────────────

export type ActionRisk = 'low' | 'medium' | 'high';

export interface AgentAction {
  type: 'TYPE' | 'SELECT' | 'CHECK' | 'CLICK' | 'SCROLL';
  targetHandle: string;
  profileKey: string;
  value: string;
  expected: string;
  risk: ActionRisk;
  requiresApproval?: boolean;
}

// ── Content-script messages ─────────────────

export interface FillRequest {
  handle: string;
  key: string;
  value: string;
  type: string;
}

export interface FillResult {
  filled: number;
  verified: boolean;
  details?: { handle: string; success: boolean; error?: string }[];
}
