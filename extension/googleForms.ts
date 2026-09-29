/* ──────────────────────────────────────────────
   ORVIA — Google Forms interaction module
   Runs inside the content script.
   ────────────────────────────────────────────── */

import type { Field, DemoProfile } from '../src/types';
import { matchLabel, resolveValue } from '../src/profile';

// ─── Helpers ────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function visible(el: HTMLElement): boolean {
  if (!el.getClientRects().length) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0;
}

function scrollTo(el: HTMLElement): Promise<void> {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return sleep(350);
}

// ─── Google Forms DOM helpers ───────────────

/**
 * Google Forms wraps each question in a container with `data-params`.
 * Each question container typically has structure:
 *   <div data-params="...">
 *     <div> (question header with label text)
 *     <div> (input area)
 */

function getQuestionContainers(): HTMLElement[] {
  // Google Forms 2024-2026 use [data-params] on each question block
  // Alternative: look for the listitem role
  const byParams = Array.from(document.querySelectorAll<HTMLElement>('[data-params]'))
    .filter(el => visible(el) && el.querySelector('input, textarea, [role="listbox"], [role="radiogroup"], [role="group"], [role="checkbox"]'));

  if (byParams.length) return byParams;

  // Fallback: question items via role
  const byRole = Array.from(document.querySelectorAll<HTMLElement>('[role="listitem"]'))
    .filter(el => visible(el));

  if (byRole.length) return byRole;

  // Fallback: find question blocks by common class patterns
  return Array.from(document.querySelectorAll<HTMLElement>('.freebirdFormviewerComponentsQuestionBaseRoot, .Qr7Oae'))
    .filter(visible);
}

function extractQuestionLabel(container: HTMLElement): string {
  // Try common Google Forms label selectors
  const selectors = [
    '[data-initial-value]',    // label span
    '.M7eMe',                  // title class
    '.OIC90c',                 // also used for titles
    '[role="heading"]',
    '.freebirdFormviewerComponentsQuestionBaseTitle',
    '.exportItemTitle',
  ];

  for (const sel of selectors) {
    const el = container.querySelector<HTMLElement>(sel);
    if (el) {
      const text = el.innerText?.trim();
      if (text && text.length > 1) return text;
    }
  }

  // Walk visible text nodes at the top of the container
  const headings = container.querySelectorAll<HTMLElement>('span, div, h2, h3, h4, label');
  for (const h of headings) {
    const text = h.innerText?.trim();
    if (text && text.length > 2 && text.length < 200 && !h.querySelector('input, textarea')) {
      return text;
    }
  }

  return '';
}

function detectFieldType(container: HTMLElement): { type: Field['type']; inputEl: HTMLElement | null; options: string[] } {
  // Check for textarea (paragraph)
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
  if (textarea && visible(textarea)) {
    return { type: 'paragraph', inputEl: textarea, options: [] };
  }

  // Check for email input
  const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]');
  if (emailInput && visible(emailInput)) {
    return { type: 'email', inputEl: emailInput, options: [] };
  }

  // Check for tel input
  const telInput = container.querySelector<HTMLInputElement>('input[type="tel"]');
  if (telInput && visible(telInput)) {
    return { type: 'tel', inputEl: telInput, options: [] };
  }

  // Check for dropdown (listbox)
  const listbox = container.querySelector<HTMLElement>('[role="listbox"]');
  if (listbox) {
    const opts = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"], [data-value]'))
      .map(o => o.textContent?.trim() ?? '')
      .filter(t => t && t !== 'Choose');
    return { type: 'dropdown', inputEl: listbox, options: opts };
  }

  // Check for radio group
  const radioGroup = container.querySelector<HTMLElement>('[role="radiogroup"]');
  if (radioGroup) {
    const opts = Array.from(radioGroup.querySelectorAll<HTMLElement>('[role="radio"], label'))
      .map(o => {
        const span = o.querySelector<HTMLElement>('.vRMGwf, .docssharedWizToggleLabeledLabelText, span');
        return (span?.textContent ?? o.textContent ?? '').trim();
      })
      .filter(t => t.length > 0);
    return { type: 'radio', inputEl: radioGroup, options: [...new Set(opts)] };
  }

  // Check for checkbox group
  const checkboxGroup = container.querySelector<HTMLElement>('[role="group"]');
  if (checkboxGroup) {
    const checkboxes = checkboxGroup.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]');
    if (checkboxes.length > 1) {
      const opts = Array.from(checkboxes).map(cb => {
        const label = cb.closest('label') || cb.parentElement;
        const span = label?.querySelector<HTMLElement>('.vRMGwf, .docssharedWizToggleLabeledLabelText, span');
        return (span?.textContent ?? label?.textContent ?? '').trim();
      }).filter(t => t.length > 0);
      return { type: 'multi-checkbox', inputEl: checkboxGroup, options: [...new Set(opts)] };
    }
  }

  // Check for single checkbox (consent)
  const singleCheckbox = container.querySelector<HTMLElement>('input[type="checkbox"], [role="checkbox"]');
  if (singleCheckbox) {
    return { type: 'consent', inputEl: singleCheckbox, options: [] };
  }

  // Check for text inputs
  const textInput = container.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
  if (textInput && visible(textInput)) {
    return { type: 'short-answer', inputEl: textInput, options: [] };
  }

  // Fallback
  const anyInput = container.querySelector<HTMLInputElement>('input');
  if (anyInput && visible(anyInput)) {
    return { type: 'short-answer', inputEl: anyInput, options: [] };
  }

  return { type: 'unknown', inputEl: null, options: [] };
}

// ─── Observe Google Form fields ─────────────

export interface GoogleFormField extends Field {
  container: HTMLElement;
  inputEl: HTMLElement | null;
  options: string[];
}

export function observeGoogleForm(): { fields: GoogleFormField[]; isGoogleForm: boolean } {
  // Detect if this is a Google Form
  const isGoogleForm =
    document.title.includes('Google Forms') ||
    !!document.querySelector('[data-params]') ||
    !!document.querySelector('.freebirdFormviewerViewFormContent') ||
    location.hostname === 'docs.google.com' && location.pathname.includes('/forms/');

  if (!isGoogleForm) return { fields: [], isGoogleForm: false };

  const containers = getQuestionContainers();
  const fields: GoogleFormField[] = [];
  const usedKeys = new Set<string>();

  containers.forEach((container, index) => {
    const label = extractQuestionLabel(container);
    if (!label) return;

    const { type, inputEl, options } = detectFieldType(container);
    if (type === 'unknown' || !inputEl) return;

    let key = matchLabel(label);
    if (!key) return;

    // Deduplicate: if key already used, skip (shouldn't happen with unique questions)
    if (usedKeys.has(key)) {
      // Try alternate keys for multi-match scenarios
      if (key === 'portfolio' && !usedKeys.has('github')) key = 'github';
      else if (key === 'github' && !usedKeys.has('portfolio')) key = 'portfolio';
      else return;
    }
    usedKeys.add(key);

    fields.push({
      handle: `gf-${index}`,
      label,
      type,
      key,
      options,
      container,
      inputEl,
    });
  });

  return { fields, isGoogleForm: true };
}

// ─── Fill a single Google Form field ────────

export async function fillGoogleFormField(
  field: GoogleFormField,
  profile: DemoProfile,
  signal?: AbortSignal,
  onHighlight?: (el: HTMLElement) => void,
  onUnhighlight?: (el: HTMLElement) => void,
): Promise<boolean> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const value = resolveValue(profile, field.key as keyof DemoProfile);
  if (!value) return false;

  // Scroll into view
  await scrollTo(field.container);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // Highlight
  onHighlight?.(field.container);

  try {
    switch (field.type) {
      case 'short-answer':
      case 'email':
      case 'tel':
        await fillTextInput(field.inputEl as HTMLInputElement, value, signal);
        break;

      case 'paragraph':
        await fillTextArea(field.inputEl as HTMLTextAreaElement, value, signal);
        break;

      case 'dropdown':
        await fillDropdown(field.inputEl as HTMLElement, value, field.options, signal);
        break;

      case 'radio':
        await fillRadio(field.inputEl as HTMLElement, value, field.options, signal);
        break;

      case 'multi-checkbox':
        await fillMultiCheckbox(field.inputEl as HTMLElement, value, signal);
        break;

      case 'consent':
        await fillCheckbox(field.inputEl as HTMLElement, signal);
        break;

      default:
        console.warn(`[ORVIA] Unsupported field type: ${field.type}`);
        return false;
    }

    await sleep(100);
    return true;
  } finally {
    onUnhighlight?.(field.container);
  }
}

// ─── Typed input filling with animation ─────

async function fillTextInput(input: HTMLInputElement, value: string, signal?: AbortSignal) {
  input.focus();
  await sleep(50);

  // Use native value setter to bypass React/Angular bindings
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  // Animate typing character by character for short values
  if (value.length <= 80) {
    for (let i = 0; i <= value.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      setter?.call(input, value.substring(0, i));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(15 + Math.random() * 10);
    }
  } else {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  await sleep(50);

  // Verify
  if (input.value !== value) {
    console.warn(`[ORVIA] Value mismatch: expected "${value}" got "${input.value}"`);
  }
}

async function fillTextArea(textarea: HTMLTextAreaElement, value: string, signal?: AbortSignal) {
  textarea.focus();
  await sleep(50);

  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

  // For long text, animate in chunks
  const chunkSize = 5;
  for (let i = 0; i <= value.length; i += chunkSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    setter?.call(textarea, value.substring(0, Math.min(i + chunkSize, value.length)));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(8);
  }

  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  textarea.dispatchEvent(new Event('blur', { bubbles: true }));
}

// ─── Dropdown filling ───────────────────────

async function fillDropdown(listbox: HTMLElement, value: string, options: string[], signal?: AbortSignal) {
  // Google Forms dropdowns: click to open, then click the matching option

  // First, try clicking the dropdown trigger
  const trigger = listbox.closest('[role="listbox"]') ||
    listbox.querySelector('[role="option"]')?.parentElement ||
    listbox;

  // Click to open
  (trigger as HTMLElement).click();
  await sleep(300);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // Find matching option — try exact match first, then fuzzy
  const allOptions = document.querySelectorAll<HTMLElement>('[role="option"], [data-value]');
  let best: HTMLElement | null = null;
  let bestScore = 0;
  const valueLower = value.toLowerCase();

  for (const opt of allOptions) {
    const text = (opt.textContent || opt.getAttribute('data-value') || '').trim().toLowerCase();
    if (!text || text === 'choose' || text === 'select') continue;

    if (text === valueLower) {
      best = opt;
      bestScore = 100;
      break;
    }

    // Fuzzy: check if value contains option text or vice versa
    if (text.includes(valueLower) || valueLower.includes(text)) {
      const score = Math.min(text.length, valueLower.length) / Math.max(text.length, valueLower.length) * 80;
      if (score > bestScore) {
        best = opt;
        bestScore = score;
      }
    }
  }

  if (best) {
    best.click();
    await sleep(150);
  } else {
    // Try clicking away to close
    document.body.click();
    console.warn(`[ORVIA] No matching dropdown option for value: ${value}`);
  }
}

// ─── Radio filling ──────────────────────────

async function fillRadio(group: HTMLElement, value: string, options: string[], signal?: AbortSignal) {
  const valueLower = value.toLowerCase();

  // Find all radio options
  const radios = group.querySelectorAll<HTMLElement>('[role="radio"], label');
  let best: HTMLElement | null = null;
  let bestScore = 0;

  for (const radio of radios) {
    const labelEl = radio.querySelector<HTMLElement>('.vRMGwf, .docssharedWizToggleLabeledLabelText, span') || radio;
    const text = (labelEl.textContent || '').trim().toLowerCase();
    if (!text) continue;

    if (text === valueLower) {
      best = radio;
      bestScore = 100;
      break;
    }

    if (text.includes(valueLower) || valueLower.includes(text)) {
      const score = Math.min(text.length, valueLower.length) / Math.max(text.length, valueLower.length) * 80;
      if (score > bestScore) {
        best = radio;
        bestScore = score;
      }
    }
  }

  if (best) {
    // Click the radio or its container
    const clickTarget = best.querySelector<HTMLElement>('[role="radio"]') || best;
    clickTarget.click();
    await sleep(100);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  } else {
    console.warn(`[ORVIA] No matching radio option for value: ${value}`);
  }
}

// ─── Multi-checkbox filling ─────────────────

async function fillMultiCheckbox(group: HTMLElement, value: string, signal?: AbortSignal) {
  const values = value.split(',').map(v => v.trim().toLowerCase());
  const checkboxes = group.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]');

  for (const cb of checkboxes) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const label = cb.closest('label') || cb.parentElement;
    const labelEl = label?.querySelector<HTMLElement>('.vRMGwf, .docssharedWizToggleLabeledLabelText, span') || label;
    const text = (labelEl?.textContent || '').trim().toLowerCase();

    if (values.some(v => text.includes(v) || v.includes(text))) {
      const clickTarget = cb.getAttribute('role') === 'checkbox' ? cb :
        (cb as HTMLInputElement);
      (clickTarget as HTMLElement).click();
      await sleep(80);
    }
  }
}

// ─── Single checkbox ────────────────────────

async function fillCheckbox(el: HTMLElement, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const isChecked =
    el.getAttribute('aria-checked') === 'true' ||
    (el as HTMLInputElement).checked === true;

  if (!isChecked) {
    el.click();
    await sleep(100);
  }
}

// ─── Find the Submit button ─────────────────

export function findSubmitButton(): HTMLElement | null {
  // Google Forms submit button selectors
  const selectors = [
    '[role="button"][jsname="M2UYVd"]',  // common submit jsname
    '.freebirdFormviewerViewNavigationSubmitButton',
    'div[role="button"] span',
  ];

  for (const sel of selectors) {
    const els = document.querySelectorAll<HTMLElement>(sel);
    for (const el of els) {
      const text = el.textContent?.toLowerCase() || '';
      if (text.includes('submit') || text.includes('send')) {
        return el.closest('[role="button"]') as HTMLElement || el;
      }
    }
  }

  // Broader search: any visible button-like element with "submit"
  const allButtons = document.querySelectorAll<HTMLElement>('[role="button"], button');
  for (const btn of allButtons) {
    if (visible(btn) && (btn.textContent?.toLowerCase().includes('submit') || btn.textContent?.toLowerCase().includes('send'))) {
      return btn;
    }
  }

  return null;
}

// ─── Verify submission success ──────────────

export function verifySubmissionSuccess(): boolean {
  // Look for Google Forms confirmation indicators
  const body = document.body.innerText.toLowerCase();

  return (
    body.includes('your response has been recorded') ||
    body.includes('response recorded') ||
    body.includes('thanks for submitting') ||
    body.includes('thank you') ||
    body.includes('has been submitted') ||
    !!document.querySelector('.freebirdFormviewerViewResponseConfirmationMessage') ||
    !!document.querySelector('.vHW8K')  // confirmation page class
  );
}
