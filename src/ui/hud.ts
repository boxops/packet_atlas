/** Heads-up display: top bar (brand, breadcrumbs, status, search, toolbar) and bottom bar. */
import type { Model } from '../data/model';
import type { ViewTarget } from '../data/types';
import { palette } from '../core/palette';
import { prefs } from '../core/prefs';
import { esc } from '../core/util';
import { el, icon, kbd, modKey } from './dom';

export interface HudHost {
  goTo(v: ViewTarget): void;
  openPalette(): void;
  incident(): void;
  toggleLegend(): void;
  toggleWallboard(): void;
  toggleSound(): void;
  toggleSettings(): void;
  toggleHelp(): void;
  home(): void;
  back(): void;
  clearFilter(): void;
  openFilterItem(kind: 'device' | 'link' | 'alarm', id: string): void;
}

export class Hud {
  readonly top: HTMLElement;
  readonly bottom: HTMLElement;
  private crumbs: HTMLElement;
  private chips: HTMLElement;
  private filterChip: HTMLDivElement;
  private banner: HTMLDivElement;
  private ticker: HTMLElement;
  private clock: HTMLElement;
  private soundBtn: HTMLButtonElement;
  private wallBtn: HTMLButtonElement;

  constructor(
    host: HTMLElement,
    private model: Model,
    private app: HudHost,
    demo: boolean,
  ) {
    this.top = el('header', 'topbar');
    this.top.innerHTML = `
      <div class="brand" data-tip="Global overview" data-key="H">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="M16 8 23 12v8l-7 4-7-4v-8z" fill="none" stroke="var(--accent)" stroke-opacity=".45" stroke-width="1.2"/><circle cx="16" cy="16" r="2.6" fill="var(--magenta)"/></svg>
        <span class="wordmark">PACKET<b>ATLAS</b></span>
      </div>
      <nav class="crumbs" aria-label="Breadcrumbs"></nav>
      <div class="status-chips" role="group" aria-label="Active problems"></div>
      <button class="search-pill glass" data-tip="Search or ask" data-key="${modKey}+K">${icon('search', 15)}<span>Search or ask…</span>${kbd(modKey)}${kbd('K')}</button>
      <div class="toolbar" role="toolbar" aria-label="Tools">
        <button class="icon-btn" data-a="incident" data-tip="Incident mode" data-key="I" aria-label="Incident mode">${icon('incident', 18)}</button>
        <button class="icon-btn" data-a="legend" data-tip="Legend" data-key="L" aria-label="Legend">${icon('legend', 18)}</button>
        <button class="icon-btn" data-a="wall" data-tip="Wallboard mode" data-key="W" aria-label="Wallboard mode">${icon('wall', 18)}</button>
        <button class="icon-btn" data-a="sound" data-tip="Sound" data-key="M" aria-label="Toggle sound"></button>
        <button class="icon-btn" data-a="settings" data-tip="Settings" data-key="S" aria-label="Settings">${icon('settings', 18)}</button>
        <button class="icon-btn" data-a="help" data-tip="Keyboard shortcuts" data-key="?" aria-label="Keyboard shortcuts">${icon('help', 18)}</button>
      </div>`;
    host.appendChild(this.top);
    this.crumbs = this.top.querySelector('.crumbs')!;
    this.chips = this.top.querySelector('.status-chips')!;
    this.soundBtn = this.top.querySelector('[data-a="sound"]')!;
    this.wallBtn = this.top.querySelector('[data-a="wall"]')!;
    this.top.querySelector('.brand')!.addEventListener('click', () => app.home());
    this.top.querySelector('.search-pill')!.addEventListener('click', () => app.openPalette());
    const acts: Record<string, () => void> = {
      incident: () => app.incident(),
      legend: () => app.toggleLegend(),
      wall: () => app.toggleWallboard(),
      sound: () => app.toggleSound(),
      settings: () => app.toggleSettings(),
      help: () => app.toggleHelp(),
    };
    this.top.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => acts[b.dataset.a!]()));
    this.chips.addEventListener('click', () => app.incident());

    this.filterChip = el('div', 'filter-chip glass');
    host.appendChild(this.filterChip);
    this.banner = el('div', 'banner glass');
    host.appendChild(this.banner);

    this.bottom = el('footer', 'bottombar');
    this.bottom.innerHTML = `
      <div class="live"><i class="live-dot"></i>LIVE<span class="ticker" aria-live="polite"></span></div>
      <div class="nav-btns">
        ${demo ? '<span class="demo-badge" data-tip="Simulated network and telemetry">DEMO DATA</span>' : ''}
        <button class="icon-btn" data-n="back" data-tip="Step out" data-key="Esc" aria-label="Step out one level">${icon('out', 16)}</button>
        <button class="icon-btn" data-n="home" data-tip="Global overview" data-key="H" aria-label="Global overview">${icon('home', 16)}</button>
        <span class="clock mono"></span>
      </div>`;
    host.appendChild(this.bottom);
    this.ticker = this.bottom.querySelector('.ticker')!;
    this.clock = this.bottom.querySelector('.clock')!;
    this.bottom.querySelector('[data-n="back"]')!.addEventListener('click', () => app.back());
    this.bottom.querySelector('[data-n="home"]')!.addEventListener('click', () => app.home());
    this.tickClock();
    window.setInterval(() => this.tickClock(), 1000);
    this.syncToggles();
  }

  private tickClock() {
    const d = new Date();
    this.clock.textContent = `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} ${Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replace('_', ' ') ?? ''}`;
  }

  syncToggles() {
    this.soundBtn.innerHTML = icon(prefs.get('sound') ? 'soundOn' : 'soundOff', 18);
    this.soundBtn.classList.toggle('on', prefs.get('sound'));
  }

  setWallboard(on: boolean) {
    this.wallBtn.classList.toggle('on', on);
  }

  setView(v: ViewTarget) {
    const trail = this.model.breadcrumbs(v);
    this.crumbs.innerHTML = trail
      .map((c, i) => `${i ? '<span class="sep">›</span>' : ''}<button class="crumb ${i === trail.length - 1 ? 'current' : ''}" data-i="${i}" ${i === trail.length - 1 ? 'aria-current="location"' : ''}>${esc(c.label)}</button>`)
      .join('');
    this.crumbs.querySelectorAll<HTMLButtonElement>('.crumb').forEach((b) => b.addEventListener('click', () => this.app.goTo(trail[+b.dataset.i!].view)));
  }

  setStatus() {
    const s = this.model.summary();
    const p = palette();
    const chip = (n: number, cls: string, glyph: string, label: string) => (n ? `<button class="chip ${cls}" data-tip="Start incident mode" data-key="I"><span class="glyph">${glyph}</span><b>${n}</b> ${label}</button>` : '');
    const html =
      chip(s.critical, 'crit', p.glyph.critical, 'critical') +
      chip(s.major + s.warning, 'warn', p.glyph.warning, 'warning') +
      chip(s.unreachable, 'ghost', p.glyph.unreachable, 'unreachable') +
      chip(s.linksDown, 'crit soft', '⇣', s.linksDown === 1 ? 'link down' : 'links down');
    this.chips.innerHTML = html || `<span class="chip ok"><span class="glyph">${p.glyph.ok}</span>All systems nominal</span>`;
  }

  pushEvent(html: string, kind: 'info' | 'warn' | 'crit' | 'ok' = 'info') {
    const item = el('span', `tick ${kind}`, html);
    this.ticker.innerHTML = '';
    this.ticker.appendChild(item);
  }

  showFilter(label: string, items: { kind: 'device' | 'link' | 'alarm'; id: string; label: string; cls?: string }[]) {
    this.filterChip.innerHTML = `
      <button class="fc-main" aria-expanded="false">${icon('search', 14)}<span>${esc(label)}</span><span class="caret">▾</span></button>
      <button class="icon-btn small" data-clear data-tip="Clear" data-key="Esc" aria-label="Clear results">${icon('close', 12)}</button>
      <div class="fc-list">${items
        .slice(0, 50)
        .map((it) => `<button class="fc-item ${it.cls ?? ''}" data-kind="${it.kind}" data-id="${it.id}">${esc(it.label)}</button>`)
        .join('')}${items.length > 50 ? `<span class="muted">+${items.length - 50} more</span>` : ''}${items.length ? '' : '<span class="muted">No matches right now</span>'}</div>`;
    this.filterChip.classList.add('open');
    const main = this.filterChip.querySelector<HTMLButtonElement>('.fc-main')!;
    main.onclick = () => {
      const on = this.filterChip.classList.toggle('expanded');
      main.setAttribute('aria-expanded', String(on));
    };
    this.filterChip.querySelector<HTMLButtonElement>('[data-clear]')!.onclick = () => this.app.clearFilter();
    this.filterChip.querySelectorAll<HTMLButtonElement>('.fc-item').forEach((b) => (b.onclick = () => this.app.openFilterItem(b.dataset.kind as 'device', b.dataset.id!)));
    if (items.length && items.length <= 8) this.filterChip.classList.add('expanded');
  }

  hideFilter() {
    this.filterChip.classList.remove('open', 'expanded');
  }

  showBanner(html: string) {
    this.banner.innerHTML = html;
    this.banner.classList.add('open');
  }

  hideBanner() {
    this.banner.classList.remove('open');
  }
}
