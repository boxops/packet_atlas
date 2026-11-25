/** Incident mode: fly through active alarms in priority order, each with a short explanation. */
import type { Model } from '../data/model';
import type { Alarm } from '../data/types';
import { palette } from '../core/palette';
import { esc, timeAgo } from '../core/util';
import { el, icon, kbd } from './dom';

export interface IncidentHost {
  focusAlarm(a: Alarm): void;
  onIncidentExit(): void;
}

export class IncidentMode {
  readonly root: HTMLDivElement;
  private list: Alarm[] = [];
  private i = 0;
  private timer = 0;
  autoplay = false;
  active = false;
  autoplayMs = 9000;

  constructor(
    host: HTMLElement,
    private model: Model,
    private app: IncidentHost,
  ) {
    this.root = el('div', 'incident glass');
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Incident mode');
    this.root.setAttribute('aria-live', 'polite');
    host.appendChild(this.root);
  }

  start(autoplay = false) {
    this.list = this.model.sortedAlarms();
    if (!this.list.length) return false;
    this.active = true;
    this.autoplay = autoplay;
    this.i = 0;
    this.root.classList.add('open');
    this.show();
    return true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.timer);
    this.root.classList.remove('open');
    this.app.onIncidentExit();
  }

  next() {
    this.go(this.i + 1);
  }

  prev() {
    this.go(this.i - 1);
  }

  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    this.show(false);
  }

  /** Refresh the list when alarms change, keeping the current alarm if it still exists. */
  sync() {
    if (!this.active) return;
    const cur = this.list[this.i]?.id;
    this.list = this.model.sortedAlarms();
    if (!this.list.length) return this.stop();
    const idx = this.list.findIndex((a) => a.id === cur);
    this.i = idx >= 0 ? idx : Math.min(this.i, this.list.length - 1);
    this.render();
  }

  private go(i: number) {
    if (!this.list.length) return;
    this.i = (i + this.list.length) % this.list.length;
    this.show();
  }

  private show(fly = true) {
    const a = this.list[this.i];
    if (!a) return;
    if (fly) this.app.focusAlarm(a);
    this.render();
    clearTimeout(this.timer);
    if (this.autoplay) this.timer = window.setTimeout(() => this.next(), this.autoplayMs);
  }

  private render() {
    const a = this.list[this.i];
    if (!a) return;
    const p = palette();
    const site = this.model.sites.get(a.siteId)?.name ?? '';
    const glyph = a.severity === 'critical' ? p.glyph.critical : p.glyph.warning;
    this.root.className = `incident glass open sev-${a.severity}`;
    this.root.innerHTML = `
      <div class="inc-progress">${this.list.map((x, j) => `<i class="sev-${x.severity} ${j === this.i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="inc-head">
        <span class="sev-badge"><span class="glyph">${glyph}</span>${a.severity}</span>
        <span class="muted">${this.i + 1} / ${this.list.length} · ${esc(site)} · ${timeAgo(a.raisedAt)}</span>
        <button class="icon-btn small" data-x aria-label="Exit incident mode" data-tip="Exit" data-key="Esc">${icon('close', 14)}</button>
      </div>
      <h3>${esc(a.title)}</h3>
      <p>${esc(a.explanation)}</p>
      <p class="inc-action"><b>Next step</b> ${esc(a.action)}</p>
      <div class="inc-foot">
        <button class="btn" data-prev aria-label="Previous alarm">${icon('prev', 14)} ${kbd('←')}</button>
        <button class="btn" data-auto aria-pressed="${this.autoplay}">${icon(this.autoplay ? 'pause' : 'play', 14)} ${this.autoplay ? 'Pause' : 'Auto-play'} ${kbd('Space')}</button>
        <button class="btn btn-accent" data-next>Next ${icon('next', 14)} ${kbd('→')}</button>
      </div>
      ${this.autoplay ? `<div class="inc-timer" style="animation-duration:${this.autoplayMs}ms"></div>` : ''}`;
    this.root.querySelector('[data-x]')!.addEventListener('click', () => this.stop());
    this.root.querySelector('[data-prev]')!.addEventListener('click', () => this.prev());
    this.root.querySelector('[data-next]')!.addEventListener('click', () => this.next());
    this.root.querySelector('[data-auto]')!.addEventListener('click', () => this.toggleAutoplay());
  }
}
