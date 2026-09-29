/* ──────────────────────────────────────────────
   ORVIA — Content script (Manifest V3)
   Injected into web pages to observe, fill and verify.
   ────────────────────────────────────────────── */

import { protect } from '../src/privacy';
import type { Field, DemoProfile, Snapshot, FillResult } from '../src/types';
import { matchLabel, resolveValue, demoProfile } from '../src/profile';
import {
  observeGoogleForm,
  fillGoogleFormField,
  findSubmitButton,
  verifySubmissionSuccess,
  type GoogleFormField,
} from './googleForms';
import {
  showCursor,
  hideCursor,
  moveCursorTo,
  cleanup as cleanupOverlays,
  setBorderState,
  highlightElement,
  unhighlightElement,
  showStatusBadge,
  hideStatusBadge,
} from './overlays';

declare global {
  interface Window {
    __orviaInstalled?: boolean;
  }
}

if (!window.__orviaInstalled) {
  window.__orviaInstalled = true;

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  let handles = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  let googleFormFields: GoogleFormField[] = [];
  let documentId = '';
  let abortController: AbortController | null = null;

  const visible = (e: HTMLElement) =>
    e.getClientRects().length > 0 &&
    getComputedStyle(e).visibility !== 'hidden' &&
    getComputedStyle(e).display !== 'none';

  // ─── Observe ────────────────────────────────

  function observe(): Snapshot {
    handles = new Map();
    googleFormFields = [];
    documentId = crypto.randomUUID();

    // Try Google Forms first
    const gf = observeGoogleForm();
    let fields: Field[] = [];
    let blocked = 0;
    let isGoogleForm = gf.isGoogleForm;

    if (isGoogleForm && gf.fields.length > 0) {
      googleFormFields = gf.fields;
      fields = gf.fields.map(f => ({
        handle: f.handle,
        label: f.label,
        type: f.type,
        key: f.key,
        options: f.options,
        required: f.required,
      }));
    } else {
      // Fallback: generic input/textarea discovery
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea').forEach((e, i) => {
        if (!visible(e)) return;
        const type = e instanceof HTMLTextAreaElement ? 'textarea' : e.type;
        const label =
          e.labels?.[0]?.innerText ||
          e.getAttribute('aria-label') ||
          e.name ||
          e.placeholder ||
          type;

        if (/password|hidden|file/.test(type) || /password|secret|token|card|cvv|ssn|aadhaar|otp/i.test(label)) {
          blocked++;
          return;
        }

        const key = matchLabel(label);
        const handle = `field-${i}`;
        if (key && !e.disabled && !e.readOnly) {
          handles.set(handle, e);
          fields.push({ handle, label: protect(label).text, type, key });
        }
      });
    }

    // Count blocked/sensitive fields
    document.querySelectorAll<HTMLInputElement>('input[type="password"], input[autocomplete*="password"]').forEach(() => blocked++);

    // Extract page text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let size = 0;
    let node: Node | null;
    while ((node = walker.nextNode()) && size < 14000) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript,input,textarea,[contenteditable="true"],[data-orvia-private]') || !visible(parent)) continue;
      const t = node.textContent?.trim();
      if (t) { parts.push(t); size += t.length; }
    }

    const raw = [document.title, ...parts].join('\n').slice(0, 14000);
    const redacted = protect(raw);

    return {
      title: protect(document.title).text,
      origin: location.origin,
      text: redacted.text,
      headings: Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3')).filter(visible).slice(0, 15).map(e => protect(e.innerText).text),
      fields,
      findings: redacted.findings,
      blocked,
      documentId,
      observedAt: Date.now(),
      isGoogleForm,
    };
  }

  // ─── Sequential fill with overlays ──────────

  async function sequentialFill(
    values: { handle: string; key: string; value: string; type: string }[],
    profile: DemoProfile,
  ): Promise<FillResult> {
    abortController = new AbortController();
    const signal = abortController.signal;
    const details: { handle: string; success: boolean; error?: string }[] = [];
    let filled = 0;

    // Activate working border
    setBorderState('working');
    showCursor();

    try {
      if (googleFormFields.length > 0) {
        // Google Forms: use specialized fill
        showStatusBadge('ORVIA is filling the form…');

        for (const field of googleFormFields) {
          if (signal.aborted) break;

          const value = resolveValue(profile, field.key as keyof DemoProfile);
          if (!value) continue;

          showStatusBadge(`Filling: ${field.label}`);

          // Move cursor to field
          if (field.inputEl) {
            await moveCursorTo(field.inputEl, 400, signal);
          }

          try {
            const ok = await fillGoogleFormField(
              field,
              profile,
              signal,
              (el) => highlightElement(el),
              () => unhighlightElement(),
            );
            details.push({ handle: field.handle, success: ok });
            if (ok) filled++;
          } catch (e) {
            if ((e as DOMException).name === 'AbortError') break;
            details.push({ handle: field.handle, success: false, error: (e as Error).message });
          }

          await sleep(250);
        }
      } else {
        // Generic fill
        for (const v of values) {
          if (signal.aborted) break;

          const el = handles.get(v.handle);
          if (!el || !el.isConnected || !visible(el)) {
            details.push({ handle: v.handle, success: false, error: 'Element no longer available' });
            continue;
          }

          showStatusBadge(`Filling: ${v.key}`);

          // Move cursor
          await moveCursorTo(el, 400, signal);
          highlightElement(el);

          // Fill using native setter
          const setter = Object.getOwnPropertyDescriptor(
            el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            'value',
          )?.set;

          el.focus();
          await sleep(50);

          // Typing animation
          if (v.value.length <= 80) {
            for (let i = 0; i <= v.value.length; i++) {
              if (signal.aborted) break;
              setter?.call(el, v.value.substring(0, i));
              el.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(15 + Math.random() * 10);
            }
          } else {
            setter?.call(el, v.value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }

          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));

          // Verify
          const ok = el.value === v.value;
          details.push({ handle: v.handle, success: ok });
          if (ok) filled++;

          unhighlightElement();
          await sleep(250);
        }
      }

      hideCursor();
      hideStatusBadge();

      if (signal.aborted) {
        setBorderState('off');
        return { filled, verified: false, details };
      }

      setBorderState('success');
      showStatusBadge(`✓ ${filled} fields filled successfully`);
      setTimeout(() => { hideStatusBadge(); setBorderState('off'); }, 3000);

      return { filled, verified: true, details };
    } catch (e) {
      setBorderState('error');
      hideCursor();
      hideStatusBadge();
      setTimeout(() => setBorderState('off'), 2000);
      throw e;
    }
  }

  // ─── Submit the form ────────────────────────

  async function submitForm(): Promise<{ submitted: boolean; verified: boolean }> {
    const submitBtn = findSubmitButton();
    if (!submitBtn) {
      return { submitted: false, verified: false };
    }

    setBorderState('working');
    showCursor();
    showStatusBadge('Submitting form…');

    await moveCursorTo(submitBtn, 500);
    highlightElement(submitBtn);
    await sleep(300);

    submitBtn.click();
    unhighlightElement();
    hideCursor();

    // Wait for page response
    await sleep(2000);

    const success = verifySubmissionSuccess();
    if (success) {
      setBorderState('success');
      showStatusBadge('✓ Submission verified');
    } else {
      setBorderState('error');
      showStatusBadge('Submission status unclear');
    }

    setTimeout(() => {
      hideStatusBadge();
      setBorderState('off');
    }, 3000);

    return { submitted: true, verified: success };
  }

  // ─── Cancel ─────────────────────────────────

  function cancel(): void {
    abortController?.abort();
    cleanupOverlays();
  }

  // ─── Message handler ────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    try {
      if (msg.type === 'CONTENT_OBSERVE') {
        respond({ ok: true, data: observe() });
      }
      if (msg.type === 'CONTENT_FILL') {
        if (msg.documentId !== documentId || msg.origin !== location.origin) {
          throw new Error('Page changed. Observe again before filling.');
        }

        const profile: DemoProfile = msg.profile || demoProfile;
        const values = msg.values as { handle: string; key: string; value: string; type: string }[];

        // Run sequential fill asynchronously
        sequentialFill(values, profile)
          .then(data => respond({ ok: true, data }))
          .catch(e => respond({ ok: false, error: (e as Error).message || 'Fill failed' }));

        return true; // async response
      }
      if (msg.type === 'CONTENT_SUBMIT') {
        submitForm()
          .then(data => respond({ ok: true, data }))
          .catch(e => respond({ ok: false, error: (e as Error).message || 'Submit failed' }));
        return true;
      }
      if (msg.type === 'CONTENT_CANCEL') {
        cancel();
        respond({ ok: true, data: { cancelled: true } });
      }
      if (msg.type === 'CONTENT_VERIFY_SUBMIT') {
        respond({ ok: true, data: { success: verifySubmissionSuccess() } });
      }
    } catch (e) {
      respond({ ok: false, error: e instanceof Error ? e.message : 'Page action failed.' });
    }
  });
}
