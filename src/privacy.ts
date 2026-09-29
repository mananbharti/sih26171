import type {Finding,Profile} from './types';
// Deterministic prototype rules, not a general-purpose PII classifier.
export function protect(text:string, known:Partial<Profile>={}) {
 const findings:Finding[]=[];
 const replace=(kind:string,pattern:RegExp)=>{let count=0; text=text.replace(pattern,()=>{count++;return `[${kind.toUpperCase()}]`});if(count)findings.push({kind,token:`[${kind.toUpperCase()}]`,count});};
 for(const [key,value] of Object.entries(known)) if(value&&value.length>2) replace(key,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'));
 replace('credential',/\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token)\s*[:=]\s*[^\s,;]+/gi);
 replace('email',/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
 replace('phone',/(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)/g);
 return {text,findings};
}
export function firewall(payload:string){
 const scan=protect(payload);
 if(scan.findings.length) throw new Error('Egress blocked: unmasked sensitive patterns remain.');
 if(payload.length>32000)throw new Error('Egress blocked: context exceeds the local limit.');
 return payload;
}
const SAFE_TYPES = [
  'text',
  'email',
  'tel',
  'textarea',
  'short-answer',
  'paragraph',
  'dropdown',
  'radio',
  'checkbox',
  'multi-checkbox',
  'consent',
];

const SAFE_KEYS = [
  'name',
  'fullName',
  'email',
  'phone',
  'university',
  'college',
  'course',
  'year',
  'role',
  'skills',
  'github',
  'portfolio',
  'resumeLink',
  'coverNote',
  'consent',
];

export function safeField(type: string, key: string) {
  return SAFE_TYPES.includes(type) && SAFE_KEYS.includes(key);
}

export function validateFields(fields: { type: string; key: string; value: string }[]) {
  if (!fields.length) throw new Error('No supported empty fields found. Try the included practice page.');
  if (fields.length > 20) throw new Error('Action blocked by local policy.');

  for (const f of fields) {
    if (!safeField(f.type, f.key)) throw new Error('Action blocked by local policy.');

    const isMultilineAllowed = f.type === 'paragraph' || f.type === 'textarea' || f.key === 'coverNote';
    if (!isMultilineAllowed && /[\r\n]/.test(f.value)) {
      throw new Error('Action blocked by local policy.');
    }

    const maxLen = isMultilineAllowed ? 1000 : 250;
    if (f.value.length > maxLen) {
      throw new Error('Action blocked by local policy.');
    }
  }

  return true;
}
