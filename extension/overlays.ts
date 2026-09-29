/* ──────────────────────────────────────────────
   ORVIA — In-page agent cursor overlay
   Content-script side: injected into the page.
   ────────────────────────────────────────────── */

const CURSOR_ID = 'orvia-agent-cursor';
const LAYER_ID = 'orvia-agent-layer';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Create the agent layer ─────────────────

function ensureLayer(): HTMLElement {
  let layer = document.getElementById(LAYER_ID);
  if (layer) return layer;

  layer = document.createElement('div');
  layer.id = LAYER_ID;
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '2147483646',
    overflow: 'hidden',
  });
  document.documentElement.appendChild(layer);
  return layer;
}

// ─── Create the cursor element ──────────────

function ensureCursor(): HTMLElement {
  let cursor = document.getElementById(CURSOR_ID);
  if (cursor) return cursor;

  const layer = ensureLayer();
  cursor = document.createElement('div');
  cursor.id = CURSOR_ID;

  // Premium pointer design
  cursor.innerHTML = `
    <svg width="24" height="28" viewBox="0 0 24 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2L4 22L8.5 17.5L12.5 25L16 23.5L12 15.5L18 15.5L4 2Z"
            fill="#3265ed" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <span style="
      position: absolute;
      top: -6px;
      left: 22px;
      background: #3265ed;
      color: white;
      font: 600 8px/1 Inter, 'Segoe UI', sans-serif;
      padding: 3px 6px;
      border-radius: 4px;
      white-space: nowrap;
      letter-spacing: 0.3px;
      box-shadow: 0 2px 8px rgba(50,101,237,.3);
    ">ORVIA</span>
  `;

  Object.assign(cursor.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    width: '24px',
    height: '28px',
    zIndex: '2147483647',
    pointerEvents: 'none',
    transition: 'none',
    opacity: '0',
    filter: 'drop-shadow(0 2px 6px rgba(50,101,237,.35))',
    willChange: 'transform, opacity',
  });

  layer.appendChild(cursor);
  return cursor;
}

// ─── Show / hide cursor ─────────────────────

export function showCursor(): void {
  const cursor = ensureCursor();
  cursor.style.opacity = '1';
}

export function hideCursor(): void {
  const cursor = document.getElementById(CURSOR_ID);
  if (cursor) {
    cursor.style.opacity = '0';
  }
}

export function removeCursor(): void {
  document.getElementById(CURSOR_ID)?.remove();
  document.getElementById(LAYER_ID)?.remove();
}

// ─── Move cursor to an element ──────────────

export async function moveCursorTo(
  target: HTMLElement,
  durationMs = 400,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const cursor = ensureCursor();
  showCursor();

  // Get target position
  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width * 0.3;
  const y = rect.top + rect.height * 0.3;

  // Smooth animation using CSS transition
  cursor.style.transition = `top ${durationMs}ms cubic-bezier(.4,.0,.2,1), left ${durationMs}ms cubic-bezier(.4,.0,.2,1)`;
  cursor.style.top = `${y}px`;
  cursor.style.left = `${x}px`;

  await sleep(durationMs + 50);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // Pulse effect
  cursor.style.transition = 'transform 150ms ease-out';
  cursor.style.transform = 'scale(1.15)';
  await sleep(150);
  cursor.style.transform = 'scale(1)';
  await sleep(100);
}

// ─── Blue working border ────────────────────

const BORDER_ID = 'orvia-working-border';

export type BorderState = 'working' | 'approval' | 'success' | 'error' | 'off';

const borderColors: Record<BorderState, string> = {
  working:  '0 0 20px rgba(50,101,237,.20), inset 0 0 0 2px rgba(96,165,250,.55)',
  approval: '0 0 20px rgba(217,168,50,.18), inset 0 0 0 2px rgba(234,179,8,.50)',
  success:  '0 0 25px rgba(20,137,121,.22), inset 0 0 0 2px rgba(52,211,153,.55)',
  error:    '0 0 20px rgba(239,68,68,.20), inset 0 0 0 2px rgba(248,113,113,.55)',
  off:      'none',
};

export function setBorderState(state: BorderState): void {
  let border = document.getElementById(BORDER_ID);

  if (state === 'off') {
    border?.remove();
    return;
  }

  if (!border) {
    const layer = ensureLayer();
    border = document.createElement('div');
    border.id = BORDER_ID;
    Object.assign(border.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483644',
      transition: 'box-shadow 600ms ease-in-out',
      borderRadius: '0',
    });
    layer.appendChild(border);
  }

  border.style.boxShadow = borderColors[state];

  // Add subtle animation for working state
  if (state === 'working') {
    border.style.animation = 'orvia-border-pulse 3s ease-in-out infinite';
    addBorderAnimation();
  } else {
    border.style.animation = 'none';
  }
}

function addBorderAnimation(): void {
  if (document.getElementById('orvia-border-keyframes')) return;
  const style = document.createElement('style');
  style.id = 'orvia-border-keyframes';
  style.textContent = `
    @keyframes orvia-border-pulse {
      0%, 100% { box-shadow: 0 0 20px rgba(50,101,237,.20), inset 0 0 0 2px rgba(96,165,250,.55); }
      50%      { box-shadow: 0 0 30px rgba(50,101,237,.28), inset 0 0 0 2px rgba(96,165,250,.70); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Active element highlight ───────────────

const HIGHLIGHT_ID = 'orvia-field-highlight';

export function highlightElement(el: HTMLElement): void {
  let highlight = document.getElementById(HIGHLIGHT_ID);
  if (!highlight) {
    const layer = ensureLayer();
    highlight = document.createElement('div');
    highlight.id = HIGHLIGHT_ID;
    Object.assign(highlight.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '2147483645',
      border: '2px solid #3B82F6',
      borderRadius: '8px',
      boxShadow: '0 0 0 4px rgba(59,130,246,.15), 0 0 20px rgba(59,130,246,.12)',
      transition: 'all 250ms cubic-bezier(.4,0,.2,1)',
    });
    layer.appendChild(highlight);
  }

  const rect = el.getBoundingClientRect();
  Object.assign(highlight.style, {
    top: `${rect.top - 4}px`,
    left: `${rect.left - 4}px`,
    width: `${rect.width + 8}px`,
    height: `${rect.height + 8}px`,
    opacity: '1',
  });
}

export function unhighlightElement(): void {
  const highlight = document.getElementById(HIGHLIGHT_ID);
  if (highlight) {
    highlight.style.opacity = '0';
  }
}

// ─── Small status badge ─────────────────────

const BADGE_ID = 'orvia-status-badge';

export function showStatusBadge(text: string): void {
  let badge = document.getElementById(BADGE_ID);
  if (!badge) {
    const layer = ensureLayer();
    badge = document.createElement('div');
    badge.id = BADGE_ID;
    Object.assign(badge.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(17,43,72,.92)',
      backdropFilter: 'blur(8px)',
      color: 'white',
      font: '500 11px/1 Inter, "Segoe UI", sans-serif',
      padding: '8px 16px',
      borderRadius: '20px',
      zIndex: '2147483647',
      pointerEvents: 'none',
      boxShadow: '0 4px 16px rgba(0,0,0,.15)',
      transition: 'opacity 300ms ease',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });
    layer.appendChild(badge);
  }

  badge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#60A5FA;box-shadow:0 0 6px #60A5FA;"></span>${text}`;
  badge.style.opacity = '1';
}

export function hideStatusBadge(): void {
  const badge = document.getElementById(BADGE_ID);
  if (badge) badge.style.opacity = '0';
}

// ─── Cleanup everything ─────────────────────

export function cleanup(): void {
  hideCursor();
  unhighlightElement();
  hideStatusBadge();
  setBorderState('off');
  // Small delay before removing layer
  setTimeout(() => {
    document.getElementById(LAYER_ID)?.remove();
  }, 600);
}
