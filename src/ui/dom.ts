/** Tiny DOM helpers, the shared tooltip, toasts and SVG icon set. */
import { esc } from '../core/util';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';

export function kbd(k: string) {
  return `<kbd>${esc(k)}</kbd>`;
}

// ── icons (inline SVG, stroke-based so they inherit currentColor) ──
const P: Record<string, string> = {
  router: '<circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="10" ry="3.2"/>',
  firewall: '<path d="M12 2l8 4.5v11L12 22l-8-4.5v-11z"/><path d="M4 9.5h16M4 14.5h16"/>',
  switch: '<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01"/>',
  ap: '<path d="M5 17a7 7 0 0 1 14 0z"/><path d="M8.5 9.5a5 5 0 0 1 7 0M6 7a8.5 8.5 0 0 1 12 0"/>',
  server: '<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/><path d="M7 7h4M7 17h4"/>',
  site: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/>',
  rack: '<rect x="6" y="2" width="12" height="20" rx="1"/><path d="M6 7h12M6 12h12M6 17h12"/>',
  link: '<path d="M4 16c4 0 4-8 8-8s4 8 8 8"/><circle cx="4" cy="16" r="1.6"/><circle cx="20" cy="16" r="1.6"/>',
  alarm: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  vlan: '<path d="M3 7h18M3 12h18M3 17h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  incident: '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/>',
  legend: '<path d="M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11"/>',
  wall: '<rect x="2" y="4" width="20" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
  soundOn: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 5M22 9l-5 5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  out: '<path d="M8 12h12M8 12l4-4M8 12l4 4"/><path d="M4 4v16"/>',
  inspect: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
  trace: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h5a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3"/>',
  neighbours: '<circle cx="12" cy="12" r="2.5"/><circle cx="4" cy="5" r="1.8"/><circle cx="20" cy="5" r="1.8"/><circle cx="4" cy="19" r="1.8"/><circle cx="20" cy="19" r="1.8"/><path d="M10 10.5L5.5 6.3M14 10.5l4.5-4.2M10 13.5l-4.5 4.2M14 13.5l4.5 4.2"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l3 3-3 3M12 15h6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  ssh: '<path d="M4 17l5-5-5-5M11 19h9"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/><path d="M8 11h6M11 8v6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M7 4v16M17 4v16"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z"/>',
};

export function icon(name: keyof typeof P | string, size = 16): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

// ── tooltip ──
let tipEl: HTMLDivElement | null = null;
let tipTimer = 0;

export function tooltip(): HTMLDivElement {
  if (!tipEl) {
    tipEl = el('div', 'tooltip');
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

export function showTip(html: string, x: number, y: number, immediate = false) {
  const t = tooltip();
  clearTimeout(tipTimer);
  const place = () => {
    t.innerHTML = html;
    t.classList.add('show');
    const r = t.getBoundingClientRect();
    let left = x + 16;
    let top = y + 18;
    if (left + r.width > innerWidth - 8) left = x - r.width - 12;
    if (top + r.height > innerHeight - 8) top = y - r.height - 12;
    t.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  };
  if (immediate) place();
  else tipTimer = window.setTimeout(place, 280);
}

export function hideTip() {
  clearTimeout(tipTimer);
  tipEl?.classList.remove('show');
}

/** Any element with data-tip gets a tooltip (with optional data-key shortcut hint). */
export function installUiTooltips() {
  document.addEventListener('pointerover', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!t || e.pointerType === 'touch') return;
    const key = t.dataset.key ? ` ${t.dataset.key.split('+').map(kbd).join('')}` : '';
    const r = t.getBoundingClientRect();
    showTip(`${esc(t.dataset.tip!)}${key}`, r.left + r.width / 2 - 20, r.bottom - 6);
  });
  document.addEventListener('pointerout', (e) => {
    if ((e.target as HTMLElement).closest('[data-tip]')) hideTip();
  });
}

// ── toasts ──
let toastHost: HTMLDivElement | null = null;

export function toast(html: string, opts: { action?: { label: string; run: () => void }; ms?: number; kind?: 'info' | 'warn' | 'crit' } = {}) {
  if (!toastHost) {
    toastHost = el('div', 'toast-host');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const t = el('div', `toast glass ${opts.kind ?? 'info'}`, `<span class="toast-msg">${html}</span>`);
  if (opts.action) {
    const b = el('button', 'btn btn-accent', esc(opts.action.label));
    b.onclick = () => {
      opts.action!.run();
      dismiss();
    };
    t.appendChild(b);
  }
  const x = el('button', 'icon-btn small', icon('close', 14));
  x.setAttribute('aria-label', 'Dismiss');
  x.onclick = () => dismiss();
  t.appendChild(x);
  toastHost.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const timer = window.setTimeout(() => dismiss(), opts.ms ?? 3800);
  function dismiss() {
    clearTimeout(timer);
    t.classList.remove('show');
    window.setTimeout(() => t.remove(), 350);
  }
  return dismiss;
}

export function sparkline(values: number[], w = 120, h = 28): string {
  if (!values.length) return '';
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - v * (h - 4)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="0,${h} ${pts.join(' ')} ${w},${h}" class="spark-fill"/><polyline points="${pts.join(' ')}" class="spark-line"/></svg>`;
}
