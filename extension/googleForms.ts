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
  // Google Forms dropdown trigger
  const trigger = listbox.getAttribute('role') === 'listbox' ? listbox :
    listbox.closest('[role="listbox"]') ||
    listbox.querySelector<HTMLElement>('[role="option"]')?.parentElement ||
    listbox;

  // Click to open dropdown menu
  (trigger as HTMLElement).click();
  await sleep(450);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // Query options — Google Forms populates options in [role="option"], [data-value], .exportOption, or .M2User
  const allOptions = Array.from(document.querySelectorAll<HTMLElement>('[role="option"], [data-value], .exportOption, .M2User, .vRMGwf'));
  
  let best: HTMLElement | null = null;
  let bestScore = 0;
  const valueLower = value.toLowerCase().trim();
  const valueWords = valueLower.split(/\s+/).filter(w => w.length > 0);

  for (const opt of allOptions) {
    const textAttr = opt.getAttribute('data-value') || opt.getAttribute('aria-label') || '';
    const textContent = opt.textContent || opt.innerText || '';
    const fullText = (textAttr + ' ' + textContent).trim().toLowerCase();

    if (!fullText || fullText === 'choose' || fullText === 'select') continue;

    // Exact match
    if (fullText === valueLower || textContent.trim().toLowerCase() === valueLower || textAttr.trim().toLowerCase() === valueLower) {
      best = opt;
      bestScore = 100;
      break;
    }

    // Includes match
    if (fullText.includes(valueLower) || valueLower.includes(fullText)) {
      const score = (Math.min(fullText.length, valueLower.length) / Math.max(fullText.length, valueLower.length)) * 85;
      if (score > bestScore) {
        best = opt;
        bestScore = score;
      }
    }

    // Number / Ordinal match for years: e.g. "1st" or "1" matching "1st Year"
    if (valueLower.includes('1st') || valueLower.includes('first') || valueLower.startsWith('1')) {
      if (fullText.includes('1st') || fullText.includes('first') || fullText.includes('1')) {
        if (90 > bestScore) {
          best = opt;
          bestScore = 90;
        }
      }
    }

    // Keyword match (e.g. "frontend" in "Frontend Intern")
    if (valueWords.length > 0 && valueWords.every(w => fullText.includes(w))) {
      if (80 > bestScore) {
        best = opt;
        bestScore = 80;
      }
    }
  }

  if (best) {
    const target = best.closest('[role="option"], [data-value]') as HTMLElement || best;
    target.click();
    await sleep(200);
  } else {
    // Try clicking document body to dismiss open dropdown if unselected
    document.body.click();
    console.warn(`[ORVIA] No matching dropdown option for value: ${value}`);
  }
}

// ─── Radio filling ──────────────────────────

async function fillRadio(group: HTMLElement, value: string, options: string[], signal?: AbortSignal) {
  const valueLower = value.toLowerCase().trim();
  const valueWords = valueLower.split(/\s+/).filter(w => w.length > 0);

  // Find all radio elements or option containers inside group
  const radioItems = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"], .docssharedWizToggleLabeledContainer, label, [data-value]'));
  
  let best: HTMLElement | null = null;
  let bestScore = 0;

  for (const item of radioItems) {
    const ariaLabel = item.getAttribute('aria-label') || item.getAttribute('data-value') || '';
    const container = item.closest('.docssharedWizToggleLabeledContainer, [role="radio"]') || item;
    const textContent = container.textContent || '';
    const fullText = (ariaLabel + ' ' + textContent).trim().toLowerCase();

    if (!fullText) continue;

    if (fullText === valueLower || ariaLabel.trim().toLowerCase() === valueLower) {
      best = item;
      bestScore = 100;
      break;
    }

    if (fullText.includes(valueLower) || valueLower.includes(fullText)) {
      const score = (Math.min(fullText.length, valueLower.length) / Math.max(fullText.length, valueLower.length)) * 85;
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }

    // Number / Ordinal match for years: e.g. "1st" or "1" matching "1st Year"
    if (valueLower.includes('1st') || valueLower.includes('first') || valueLower.startsWith('1')) {
      if (fullText.includes('1st') || fullText.includes('first') || fullText.includes('1')) {
        if (90 > bestScore) {
          best = item;
          bestScore = 90;
        }
      }
    }

    // Keyword match (e.g. "frontend" in "Frontend Intern")
    if (valueWords.length > 0 && valueWords.every(w => fullText.includes(w))) {
      if (80 > bestScore) {
        best = item;
        bestScore = 80;
      }
    }
  }

  if (best) {
    const clickTarget = best.getAttribute('role') === 'radio' ? best : best.querySelector<HTMLElement>('[role="radio"]') || best;
    clickTarget.click();
    await sleep(150);
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
