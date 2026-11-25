/**
 * Universal command palette (Ctrl/Cmd+K). One box for everything: hostnames, IPs, MACs, VLANs,
 * sites, alarms, commands, bookmarks, and natural-language questions.
 */
import type { Model } from '../data/model';
import { alarmEntries, buildIndex, search, scoreKey, type SearchEntry } from '../core/search';
import { describeFilter, parseQuery, runFilter } from '../core/query';
import { tracePath } from '../core/path';
import { prefs } from '../core/prefs';
import { esc } from '../core/util';
import { el, icon, kbd, modKey } from './dom';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  key?: string;
  icon: string;
  run: () => void;
}

interface Row {
  group: string;
  icon: string;
  label: string;
  sub?: string;
  key?: string;
  cls?: string;
  run: () => void;
}

export interface PaletteHost {
  open(entry: SearchEntry): void;
  applyQuery(text: string): void;
  trace(from: string, to: string): void;
  restoreBookmark(id: string): void;
  commands(): Command[];
}

const SUGGESTIONS = ['show me all down links in London', 'path from 10.1.1.10 to 10.2.2.20', 'critical alarms', 'firewalls in Frankfurt', 'links over 80%', 'unreachable devices', 'vlan 300 in Tokyo'];

export class CommandPalette {
  readonly root: HTMLDivElement;
  private input: HTMLInputElement;
  private list: HTMLDivElement;
  private index: SearchEntry[] = [];
  private rows: Row[] = [];
  private active = 0;
  private recent: SearchEntry[] = [];
  private lastFocus: Element | null = null;

  constructor(
    host: HTMLElement,
    private model: Model,
    private app: PaletteHost,
  ) {
    this.root = el('div', 'palette-backdrop');
    this.root.innerHTML = `
      <div class="palette glass" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="palette-input">${icon('search', 18)}
          <input type="text" spellcheck="false" autocomplete="off" aria-label="Search or ask"
            placeholder="Search hosts, IPs, MACs, VLANs, sites, alarms… or ask a question" />
          ${kbd('Esc')}
        </div>
        <div class="palette-list" role="listbox"></div>
        <div class="palette-foot"><span>${kbd('↑')}${kbd('↓')} navigate</span><span>${kbd('↵')} go</span><span>Try “path from A to B”, “down links in London”</span></div>
      </div>`;
    this.input = this.root.querySelector('input')!;
    this.list = this.root.querySelector('.palette-list')!;
    host.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    model.on('topology-loaded', () => (this.index = buildIndex(model)));
    this.index = buildIndex(model);
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  open(prefill = '') {
    this.lastFocus = document.activeElement;
    this.root.classList.add('open');
    this.input.value = prefill;
    this.render();
    // Focus synchronously so fast typists never trigger global shortcuts on slow frames.
    this.input.focus();
    this.input.setSelectionRange(prefill.length, prefill.length);
  }

  close() {
    this.root.classList.remove('open');
    this.input.blur();
    (this.lastFocus as HTMLElement | null)?.focus?.();
  }

  remember(e: SearchEntry) {
    this.recent = [e, ...this.recent.filter((r) => r.id !== e.id)].slice(0, 5);
  }

  private entryRow(e: SearchEntry, group: string): Row {
    const ic = e.kind === 'device' ? this.model.devices.get(e.id)!.role : e.kind;
    let cls = '';
    if (e.kind === 'device') {
      const h = this.model.deviceHealth(e.id);
      if (h !== 'ok') cls = `h-${h}`;
    } else if (e.kind === 'alarm') cls = e.sub.startsWith('CRITICAL') ? 'h-critical' : 'h-warning';
    return {
      group,
      icon: ic,
      label: e.label,
      sub: e.sub,
      cls,
      run: () => {
        this.remember(e);
        this.app.open(e);
      },
    };
  }

  private render() {
    const q = this.input.value.trim();
    const rows: Row[] = [];
    if (!q) {
      for (const a of alarmEntries(this.model).slice(0, 4)) rows.push(this.entryRow(a, 'Active alarms'));
      for (const r of this.recent) rows.push(this.entryRow(r, 'Recent'));
      for (const b of prefs.get('bookmarks')) rows.push({ group: 'Bookmarks', icon: 'bookmark', label: b.name, sub: 'Saved view', run: () => this.app.restoreBookmark(b.id) });
      for (const s of SUGGESTIONS.slice(0, 4)) rows.push({ group: 'Try asking', icon: 'search', label: s, cls: 'suggest', run: () => this.open(s) });
    } else {
      const parsed = parseQuery(q, this.model);
      if (parsed?.kind === 'path') {
        const p = tracePath(this.model, parsed.from, parsed.to);
        rows.push({
          group: 'Answer',
          icon: 'trace',
          label: p.ok ? `Trace path ${p.from!.hostname} → ${p.to!.hostname}` : `Trace path: ${p.error}`,
          sub: p.ok ? `${p.hops.length - 1} hops · ~${p.latencyMs.toFixed(1)} ms one-way` : undefined,
          cls: p.ok ? 'answer' : 'answer error',
          run: () => this.app.trace(parsed.from, parsed.to),
        });
      } else if (parsed) {
        const r = runFilter(parsed, this.model);
        rows.push({ group: 'Answer', icon: 'search', label: describeFilter(parsed, r, this.model), sub: 'Highlight results on the map', cls: 'answer', run: () => this.app.applyQuery(q) });
      }
      const ql = q.toLowerCase();
      const cmds = this.app
        .commands()
        .map((c) => ({ c, s: Math.max(scoreKey(c.label, ql), c.hint ? scoreKey(c.hint, ql) * 0.8 : 0) }))
        .filter((x) => x.s >= 35)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4);
      const hits = search([...this.index, ...alarmEntries(this.model)], q, 30);
      const groups: Record<string, string> = { site: 'Sites', rack: 'Racks', device: 'Devices', link: 'Links', alarm: 'Alarms', vlan: 'VLANs' };
      const ordered = [...hits].sort((a, b) => Object.keys(groups).indexOf(a.kind) - Object.keys(groups).indexOf(b.kind) || b.score - a.score);
      // Keep the single best hit at the very top so Enter does the obvious thing.
      if (hits[0] && !parsed) rows.push(this.entryRow(hits[0], 'Top result'));
      for (const h of ordered) if (h !== hits[0] || parsed) rows.push(this.entryRow(h, groups[h.kind]));
      for (const { c } of cmds) rows.push({ group: 'Commands', icon: c.icon, label: c.label, sub: c.hint, key: c.key, run: c.run });
      for (const b of prefs.get('bookmarks')) if (scoreKey(b.name, ql) > 40) rows.push({ group: 'Bookmarks', icon: 'bookmark', label: b.name, run: () => this.app.restoreBookmark(b.id) });
      if (!rows.length) rows.push({ group: 'No matches', icon: 'search', label: `Nothing matches “${q}”`, sub: 'Try a hostname, IP, site or a question like “down links in London”', cls: 'empty', run: () => {} });
    }
    this.rows = rows;
    this.active = 0;
    let html = '';
    let lastGroup = '';
    rows.forEach((r, i) => {
      if (r.group !== lastGroup) {
        html += `<div class="pl-group">${esc(r.group)}</div>`;
        lastGroup = r.group;
      }
      html += `<div class="pl-row ${r.cls ?? ''}" role="option" data-i="${i}" id="pl-${i}">
        <span class="pl-icon">${icon(r.icon, 16)}</span>
        <span class="pl-text"><span class="pl-label">${esc(r.label)}</span>${r.sub ? `<span class="pl-sub">${esc(r.sub)}</span>` : ''}</span>
        ${r.key ? `<span class="pl-key">${r.key.split('+').map(kbd).join('')}</span>` : ''}
      </div>`;
    });
    this.list.innerHTML = html;
    this.list.querySelectorAll<HTMLElement>('.pl-row').forEach((row) => {
      row.onpointermove = () => this.setActive(+row.dataset.i!, false);
      row.onclick = () => this.exec(+row.dataset.i!);
    });
    this.setActive(0, false);
  }

  private setActive(i: number, scroll = true) {
    if (!this.rows.length) return;
    this.active = (i + this.rows.length) % this.rows.length;
    this.list.querySelectorAll('.pl-row').forEach((r) => r.classList.toggle('active', +(r as HTMLElement).dataset.i! === this.active));
    this.input.setAttribute('aria-activedescendant', `pl-${this.active}`);
    if (scroll) this.list.querySelector(`#pl-${this.active}`)?.scrollIntoView({ block: 'nearest' });
  }

  private exec(i: number) {
    const r = this.rows[i];
    if (!r || r.cls === 'empty') return;
    if (r.cls !== 'suggest') this.close();
    r.run();
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.setActive(this.active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.setActive(this.active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.exec(this.active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    } else if (e.key === 'Tab') {
      // Tab completes the highlighted suggestion/label into the box.
      e.preventDefault();
      const r = this.rows[this.active];
      if (r && (r.cls === 'suggest' || r.group === 'Devices' || r.group === 'Top result')) {
        this.input.value = r.label;
        this.render();
      }
    }
  }
}

export const PALETTE_HINT = `${modKey}+K`;
