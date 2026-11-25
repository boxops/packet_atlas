/** Legend, shortcut overlay, settings drawer, guided tour and empty state. */
import { palette } from '../core/palette';
import { accessibilityMode, prefs, setAccessibilityMode, type Accent, type EffectsLevel } from '../core/prefs';
import { esc } from '../core/util';
import { el, icon, kbd } from './dom';
import { SHORTCUTS } from './shortcuts';

// ── legend ──

export class Legend {
  readonly root: HTMLElement;
  constructor(host: HTMLElement) {
    this.root = el('aside', 'legend glass');
    this.root.setAttribute('aria-label', 'Legend');
    host.appendChild(this.root);
    this.render();
  }
  render() {
    const p = palette();
    const roles: [string, string][] = [
      ['router', 'Router'],
      ['firewall', 'Firewall'],
      ['switch', 'Switch'],
      ['ap', 'Access point'],
      ['server', 'Server'],
    ];
    this.root.innerHTML = `
      <div class="legend-head"><h3>Legend</h3><button class="icon-btn small" data-close aria-label="Close legend">${icon('close', 14)}</button></div>
      <div class="lg-sec"><h4>Devices</h4><div class="lg-grid">${roles.map(([r, n]) => `<span>${icon(r, 18)}${n}</span>`).join('')}</div></div>
      <div class="lg-sec"><h4>Health</h4>
        <div class="lg-row"><i class="dot" style="--c:${p.health.ok}"></i><b>${p.glyph.ok}</b> Healthy: soft glow</div>
        <div class="lg-row"><i class="dot pulse" style="--c:${p.health.warning}"></i><b>${p.glyph.warning}</b> Warning: amber pulse</div>
        <div class="lg-row"><i class="dot ring" style="--c:${p.health.critical}"></i><b>${p.glyph.critical}</b> Critical: red + shockwave</div>
        <div class="lg-row"><i class="dot ghost" style="--c:${p.health.unreachable}"></i><b>${p.glyph.unreachable}</b> Unreachable: wireframe ghost</div>
        <div class="lg-row"><i class="dot flicker" style="--c:${p.health.warning}"></i>Flapping: glitch / flicker</div>
        <div class="lg-row"><i class="beam" style="--c:${p.health.critical}"></i>Light beam: active alarm</div>
      </div>
      <div class="lg-sec"><h4>Links</h4>
        <div class="lg-row"><i class="tube thin"></i><i class="tube thick"></i>Thickness: capacity (1G → 400G)</div>
        <div class="lg-row"><i class="particles"></i>Particles: live throughput (speed + density)</div>
        <div class="lg-row lg-col"><span>Colour: utilisation</span><i class="ramp" style="background:linear-gradient(90deg, ${p.util[0]}, ${p.util[1]}, ${p.util[2]})"></i><span class="ramp-labels"><span>0%</span><span>50%</span><span>90%+</span></span></div>
        <div class="lg-row"><i class="tube" style="--c:${p.health.warning}"></i>Amber: congested ≥ 90% or flapping</div>
        <div class="lg-row"><i class="tube dashed" style="--c:${p.health.critical}"></i>Red blinking: link down</div>
      </div>
      <div class="lg-sec"><h4>Highlights</h4>
        <div class="lg-row"><i class="tube" style="--c:${p.magenta}"></i>Magenta: selection & traced path</div>
        <div class="lg-row"><span class="tier-chip">CORE</span><span class="tier-chip">DIST</span><span class="tier-chip">ACCESS</span> tiers, top → ground</div>
      </div>`;
  }
  get isOpen() {
    return this.root.classList.contains('open');
  }
  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    this.root.classList.toggle('open', on);
    prefs.set('legend', on);
  }
}

// ── shortcuts overlay ──

export class ShortcutOverlay {
  readonly root: HTMLDivElement;
  constructor(host: HTMLElement) {
    this.root = el('div', 'modal-backdrop');
    this.root.innerHTML = `<div class="modal glass shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div class="modal-head"><h3>Keyboard shortcuts</h3><button class="icon-btn small" data-close aria-label="Close">${icon('close', 14)}</button></div>
      <div class="sc-grid">${SHORTCUTS.map(
        (g) => `<section><h4>${esc(g.group)}</h4>${g.items
          .map((s) => `<div class="sc-row"><span class="sc-keys">${s.keys.map((k) => k.split('+').map(kbd).join('<i>+</i>')).join('<i>or</i>')}</span><span>${esc(s.label)}</span></div>`)
          .join('')}</section>`,
      ).join('')}</div></div>`;
    host.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.toggle(false);
    });
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.toggle(false));
  }
  get isOpen() {
    return this.root.classList.contains('open');
  }
  toggle(force?: boolean) {
    this.root.classList.toggle('open', force ?? !this.isOpen);
  }
}

// ── settings drawer ──

export interface SettingsHost {
  replayTour(): void;
  restoreBookmark(id: string): void;
}

export class SettingsDrawer {
  readonly root: HTMLElement;
  constructor(
    host: HTMLElement,
    private app: SettingsHost,
  ) {
    this.root = el('aside', 'drawer glass');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Settings');
    host.appendChild(this.root);
    prefs.on('change', () => this.isOpen && this.render());
    this.render();
  }
  get isOpen() {
    return this.root.classList.contains('open');
  }
  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    if (on) this.render();
    this.root.classList.toggle('open', on);
  }
  private toggleRow(key: 'colorBlind' | 'reducedMotion' | 'effectsOff' | 'scanlines' | 'sound', label: string, hint: string) {
    return `<label class="toggle-row"><span><b>${label}</b><small>${hint}</small></span><input type="checkbox" data-pref="${key}" ${prefs.get(key) ? 'checked' : ''}/><i class="switch"></i></label>`;
  }
  render() {
    const fx = prefs.get('effects');
    const levels: [EffectsLevel, string, string][] = [
      ['ultra', 'Ultra', 'Bloom, depth of field, full particles'],
      ['balanced', 'Balanced', 'Bloom at half resolution, no depth of field'],
      ['performance', 'Performance', 'For weaker GPUs: no post-processing'],
    ];
    const accents: [Accent, string][] = [
      ['cyan', '#00e5ff'],
      ['emerald', '#2bffb4'],
      ['violet', '#9d8cff'],
    ];
    const bms = prefs.get('bookmarks');
    this.root.innerHTML = `
      <div class="modal-head"><h3>Settings</h3><button class="icon-btn small" data-close aria-label="Close settings">${icon('close', 14)}</button></div>
      <section><h4>Effects</h4>
        <div class="seg" role="radiogroup">${levels.map(([k, n, h]) => `<button role="radio" aria-checked="${fx === k}" class="${fx === k ? 'active' : ''}" data-effects="${k}" data-tip="${h}">${n}</button>`).join('')}</div>
        <small class="muted">${prefs.get('effectsPinned') ? 'Chosen by you.' : 'Adjusts automatically if the frame rate drops.'}</small>
      </section>
      <section><h4>Accessibility</h4>
        <label class="toggle-row strong"><span><b>Accessibility mode</b><small>All three below in one switch</small></span><input type="checkbox" data-a11y ${accessibilityMode() ? 'checked' : ''}/><i class="switch"></i></label>
        ${this.toggleRow('colorBlind', 'Colour-blind-safe palette', 'Okabe–Ito colours, plus shape glyphs everywhere')}
        ${this.toggleRow('reducedMotion', 'Reduced motion', 'No idle animation; shorter, gentler transitions')}
        ${this.toggleRow('effectsOff', 'Effects off', 'No bloom, glitch, shockwaves or overlays')}
      </section>
      <section><h4>Ambience</h4>
        ${this.toggleRow('scanlines', 'Scanline & grain overlay', 'Subtle film texture')}
        ${this.toggleRow('sound', 'Sound', 'Soft hum, UI clicks, alarm tone')}
        <div class="accent-row"><span>Accent</span>${accents.map(([k, c]) => `<button class="swatch ${prefs.get('accent') === k ? 'active' : ''}" style="--c:${c}" data-accent="${k}" aria-label="${k} accent" data-tip="${k}"></button>`).join('')}</div>
      </section>
      <section><h4>Bookmarks</h4>
        ${bms.length ? bms.map((b) => `<div class="bm-row"><button class="link-btn" data-bm="${b.id}">${icon('bookmark', 14)} ${esc(b.name)}</button><button class="icon-btn small" data-bm-del="${b.id}" aria-label="Delete bookmark">${icon('close', 12)}</button></div>`).join('') : `<small class="muted">Press ${kbd('B')} to bookmark the current view.</small>`}
      </section>
      <section class="row-actions">
        <button class="btn" data-tour>${icon('play', 14)} Replay tour</button>
        <button class="btn ghost" data-reset>Reset preferences</button>
      </section>`;
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.toggle(false));
    this.root.querySelectorAll<HTMLButtonElement>('[data-effects]').forEach((b) =>
      b.addEventListener('click', () => {
        prefs.set('effectsPinned', true);
        prefs.set('effects', b.dataset.effects as EffectsLevel);
      }),
    );
    this.root.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((i) => i.addEventListener('change', () => prefs.set(i.dataset.pref as 'sound', i.checked)));
    this.root.querySelector<HTMLInputElement>('[data-a11y]')!.addEventListener('change', (e) => setAccessibilityMode((e.target as HTMLInputElement).checked));
    this.root.querySelectorAll<HTMLButtonElement>('[data-accent]').forEach((b) => b.addEventListener('click', () => prefs.set('accent', b.dataset.accent as Accent)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-bm]').forEach((b) => b.addEventListener('click', () => this.app.restoreBookmark(b.dataset.bm!)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-bm-del]').forEach((b) =>
      b.addEventListener('click', () => {
        prefs.set('bookmarks', prefs.get('bookmarks').filter((x) => x.id !== b.dataset.bmDel));
        this.render();
      }),
    );
    this.root.querySelector('[data-tour]')!.addEventListener('click', () => {
      this.toggle(false);
      this.app.replayTour();
    });
    this.root.querySelector('[data-reset]')!.addEventListener('click', () => prefs.reset());
  }
}

// ── guided tour (skippable, < 60 s) ──

interface TourStep {
  target: string | null;
  title: string;
  body: string;
}

export class Tour {
  readonly root: HTMLDivElement;
  private i = 0;
  private steps: TourStep[];
  private card: HTMLDivElement;
  private spot: HTMLDivElement;
  private timer = 0;
  onEnd: (() => void) | null = null;

  constructor(host: HTMLElement, modKeyLabel: string) {
    this.steps = [
      { target: null, title: 'This is your network, live', body: 'Every island is a site. Tiers stack from WAN/core at the top down to servers at ground level. Red beams mark problems that need you now.' },
      { target: '.status-chips', title: 'Problems come to you', body: `Live alarm counts. Click them, or press ${kbd('I')}, to fly through each incident in priority order with an explanation.` },
      { target: '.search-pill', title: 'One box for everything', body: `${kbd(modKeyLabel)}${kbd('K')}: type a hostname, IP, MAC, VLAN or site, or ask “path from 10.1.1.10 to 10.2.2.20”.` },
      { target: '.crumbs', title: 'Move like a camera', body: `Click to focus, double-click to zoom in, ${kbd('Esc')} to step out. Breadcrumbs jump between levels.` },
      { target: null, title: 'Right-click anything', body: 'A radial menu offers quick actions: inspect, trace path, neighbours, show commands, copy IP, SSH.' },
      { target: '.toolbar', title: 'Make it yours', body: `${kbd('L')} legend, ${kbd('?')} shortcuts, ${kbd('S')} settings: accessibility mode, performance mode, sound and theme.` },
    ];
    this.root = el('div', 'tour');
    this.spot = el('div', 'tour-spot');
    this.card = el('div', 'tour-card glass');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    this.root.append(this.spot, this.card);
    host.appendChild(this.root);
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  start() {
    this.i = 0;
    this.root.classList.add('open');
    this.render();
  }

  next() {
    if (this.i >= this.steps.length - 1) return this.end();
    this.i++;
    this.render();
  }

  end() {
    clearTimeout(this.timer);
    this.root.classList.remove('open');
    prefs.set('tourDone', true);
    this.onEnd?.();
  }

  private render() {
    const s = this.steps[this.i];
    const target = s.target ? document.querySelector<HTMLElement>(s.target) : null;
    if (target) {
      const r = target.getBoundingClientRect();
      this.spot.style.cssText = `left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;opacity:1`;
      const cardW = 340;
      const left = Math.min(Math.max(12, r.left + r.width / 2 - cardW / 2), innerWidth - cardW - 12);
      const top = r.bottom + 16 + 200 > innerHeight ? r.top - 16 - 190 : r.bottom + 16;
      this.card.style.cssText = `left:${left}px;top:${top}px`;
    } else {
      this.spot.style.cssText = `left:50%;top:50%;width:0;height:0;opacity:0`;
      this.card.style.cssText = `left:calc(50% - 170px);top:calc(50% + 60px)`;
    }
    this.card.innerHTML = `
      <div class="tour-step">${this.i + 1} / ${this.steps.length}<span class="muted"> · under a minute</span></div>
      <h3>${s.title}</h3><p>${s.body}</p>
      <div class="tour-foot">
        <div class="dots">${this.steps.map((_, j) => `<i class="${j === this.i ? 'on' : ''}"></i>`).join('')}</div>
        <button class="btn ghost" data-skip>Skip</button>
        <button class="btn btn-accent" data-next>${this.i === this.steps.length - 1 ? 'Done' : 'Next'} ${kbd('↵')}</button>
      </div>`;
    this.card.querySelector('[data-skip]')!.addEventListener('click', () => this.end());
    this.card.querySelector('[data-next]')!.addEventListener('click', () => this.next());
    (this.card.querySelector('[data-next]') as HTMLButtonElement).focus({ preventScroll: true });
    // Auto-advance keeps the whole tour under 60 s even if the user just watches.
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.next(), 9000);
  }
}

// ── empty state ──

export function emptyState(host: HTMLElement, reason: string, onDemo: () => void): HTMLDivElement {
  const root = el('div', 'empty-state');
  root.innerHTML = `<div class="glass empty-card">
    <div class="empty-mark">${icon('site', 42)}</div>
    <h2>No network data yet</h2>
    <p>${esc(reason)}</p>
    <p class="muted">Connect a data source (see <span class="mono">docs/DATA_MODEL.md</span>), or explore Packet Atlas with a realistic demo network.</p>
    <button class="btn btn-accent big" data-demo>${icon('play', 14)} Load demo network</button>
  </div>`;
  root.querySelector('[data-demo]')!.addEventListener('click', () => {
    root.classList.add('closing');
    window.setTimeout(() => root.remove(), 400);
    onDemo();
  });
  host.appendChild(root);
  return root;
}
