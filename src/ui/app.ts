/**
 * Application controller: owns navigation state, routes input (mouse, touch, keyboard),
 * and connects the 3D world with every UI surface.
 */
import * as THREE from 'three';
import type { Model } from '../data/model';
import type { Alarm, Selection, ViewTarget } from '../data/types';
import { World } from '../scene/world';
import { prefs, setAccessibilityMode, accessibilityMode, type EffectsLevel } from '../core/prefs';
import { applyCssPalette, palette } from '../core/palette';
import { sound } from '../core/audio';
import { parseQuery, runFilter, describeFilter } from '../core/query';
import { search, buildIndex, type SearchEntry } from '../core/search';
import { tracePath, type PathResult } from '../core/path';
import { esc, pct } from '../core/util';
import { hideTip, icon, installUiTooltips, modKey, showTip, toast } from './dom';
import { Hud } from './hud';
import { AnchoredPanel, ConsolePanel, type Anchor, type CommandRunner } from './panel';
import { CommandPalette, type Command } from './palette';
import { RadialMenu, type RadialItem } from './radial';
import { Legend, SettingsDrawer, ShortcutOverlay, Tour } from './overlays';
import { IncidentMode } from './incident';
import { Wallboard } from './wallboard';
import { applyLive, healthPill, liveSelection, renderSelection, showCommands, showOutput } from './content';

interface FilterState {
  label: string;
  devices: string[];
  links: string[];
}

export class App {
  readonly world: World;
  private hud: Hud;
  private panel: AnchoredPanel;
  private consolePanel: ConsolePanel;
  private palette: CommandPalette;
  private radial: RadialMenu;
  private legend: Legend;
  private help: ShortcutOverlay;
  private settings: SettingsDrawer;
  private tour: Tour;
  private incidents: IncidentMode;
  private wallboard: Wallboard;

  view: ViewTarget = { level: 'global' };
  selection: Selection | null = null;
  private anchorFn: Anchor | null = null;
  private panelMode: 'selection' | 'path' | null = null;
  private filter: FilterState | null = null;
  private path: PathResult | null = null;
  private pathPickFrom: string | null = null;
  private lastClick: { t: number; x: number; y: number; sel: Selection | null } = { t: 0, x: 0, y: 0, sel: null };
  private camSaveTimer = 0;

  constructor(
    private model: Model,
    ui: HTMLElement,
    stage: HTMLElement,
    private demo: boolean,
  ) {
    applyCssPalette();
    this.syncBodyClasses();
    this.world = new World(stage, model);
    ui.insertAdjacentHTML('beforeend', '<div class="fx-vignette"></div><div class="fx-scanlines"></div>');
    this.hud = new Hud(ui, model, this, demo);
    const project = (v: THREE.Vector3) => this.world.project(v);
    this.panel = new AnchoredPanel(ui, project);
    this.panel.onClose = () => this.closePanel();
    this.consolePanel = new ConsolePanel(ui);
    this.palette = new CommandPalette(ui, model, this);
    this.radial = new RadialMenu(ui);
    this.legend = new Legend(ui);
    this.legend.root.querySelector('[data-close]')?.addEventListener('click', () => this.legend.toggle(false));
    this.help = new ShortcutOverlay(ui);
    this.settings = new SettingsDrawer(ui, this);
    this.tour = new Tour(ui, modKey);
    this.incidents = new IncidentMode(ui, model, this);
    this.wallboard = new Wallboard(model, this);
    installUiTooltips();

    this.panel.body.addEventListener('click', (e) => this.onPanelClick(e));
    this.world.on('frame', ({ dt }) => this.panel.update(dt));
    this.world.on('perf-low', ({ fps }) => this.onPerfLow(fps));
    this.world.rig.onUserInput = () => {
      this.wallboard.nudge();
      if (this.wallboard.active) this.world.rig.controls.autoRotate = false;
    };
    this.world.rig.controls.addEventListener('end', () => this.saveCamera());
    this.bindPointer(this.world.renderer.domElement);
    // Site labels float above the canvas: click focuses the site, double-click enters it.
    const siteFromLabel = (e: MouseEvent) => (e.target as HTMLElement).closest<HTMLElement>('.label-site')?.dataset.siteId;
    this.world.labels.domElement.addEventListener('click', (e) => {
      const id = siteFromLabel(e);
      if (id) this.select({ kind: 'site', id }, { focus: true });
    });
    this.world.labels.domElement.addEventListener('dblclick', (e) => {
      const id = siteFromLabel(e);
      if (id) this.goTo({ level: 'site', siteId: id });
    });
    this.bindKeys();
    this.bindModel();
    prefs.on('change', ({ key }) => this.onPref(key));
    if (prefs.get('legend')) this.legend.toggle(true);
  }

  // ── boot ──

  async boot(opts: { wallboard: boolean; forceTour: boolean }) {
    this.world.build();
    this.world.start();
    performance.mark('packet-atlas:interactive');
    this.hud.setView(this.view);
    this.hud.setStatus();
    const s = this.model.summary();
    const counts = `${this.model.topo.devices.length} devices · ${this.model.topo.sites.length} sites · ${s.critical + s.major + s.warning} active alarms`;
    this.hud.pushEvent(this.demo ? `Streaming simulated telemetry · ${counts}` : `Topology snapshot loaded · ${counts}`);
    void this.world.reveal();
    await this.world.introFlyIn();
    if (opts.wallboard) {
      this.toggleWallboard(true);
      return;
    }
    if (opts.forceTour || !prefs.get('tourDone')) {
      window.setTimeout(() => this.tour.start(), 250);
      return;
    }
    const last = prefs.get('lastView');
    if (last && last.level !== 'global' && this.viewExists(last)) {
      const label = this.model
        .breadcrumbs(last)
        .slice(1)
        .map((c) => c.label)
        .join(' › ');
      toast(`Resume where you left off: <b>${esc(label)}</b>`, { action: { label: 'Resume', run: () => this.goTo(last) }, ms: 8000 });
    }
  }

  private viewExists(v: ViewTarget) {
    switch (v.level) {
      case 'global':
        return true;
      case 'site':
        return this.model.sites.has(v.siteId);
      case 'rack':
        return this.model.racks.has(v.rackId);
      case 'device':
        return this.model.devices.has(v.deviceId);
      case 'link':
        return this.model.links.has(v.linkId);
    }
  }

  // ── navigation ──

  /** Shift the subject left on wide screens so the anchored panel has room on the right. */
  private biasFor(v: ViewTarget) {
    if (innerWidth < 1100) return 0;
    return v.level === 'device' || v.level === 'rack' ? 0.8 : v.level === 'site' ? 0.45 : 0;
  }

  goTo(v: ViewTarget, opts: { select?: boolean } = {}) {
    this.view = v;
    if (opts.select !== false) {
      const sel: Selection | null = v.level === 'global' ? null : v.level === 'site' ? { kind: 'site', id: v.siteId } : v.level === 'rack' ? { kind: 'rack', id: v.rackId } : v.level === 'device' ? { kind: 'device', id: v.deviceId } : { kind: 'link', id: v.linkId };
      this.select(sel, { focus: false });
    }
    void this.world.goTo(v, { biasLeft: this.biasFor(v), biasUp: innerWidth < 760 && v.level !== 'global' ? 0.9 : 0 }).then(() => this.saveCamera());
    this.hud.setView(v);
    prefs.set('lastView', v);
    sound.whoosh();
  }

  home() {
    this.clearTransient();
    this.goTo({ level: 'global' });
  }

  /** Esc: close the most transient thing first, then step out one level. */
  back() {
    if (this.radial.isOpen) return this.radial.close();
    if (this.palette.isOpen) return this.palette.close();
    if (this.help.isOpen) return this.help.toggle(false);
    if (this.tour.isOpen) return this.tour.end();
    if (this.settings.isOpen) return this.settings.toggle(false);
    if (this.consolePanel.open) return this.consolePanel.hide();
    if (this.pathPickFrom) return this.cancelPathPick();
    if (this.incidents.active) return this.incidents.stop();
    if (this.filter || this.path) return this.clearFilter();
    if (this.selection && !this.selectionMatchesView()) return this.select(null);
    const parent = this.model.parentView(this.view);
    if (parent) return this.goTo(parent);
    this.select(null);
  }

  private selectionMatchesView() {
    const s = this.selection;
    const v = this.view;
    if (!s) return false;
    return (s.kind === 'site' && v.level === 'site' && v.siteId === s.id) || (s.kind === 'rack' && v.level === 'rack' && v.rackId === s.id) || (s.kind === 'device' && v.level === 'device' && v.deviceId === s.id) || (s.kind === 'link' && v.level === 'link' && v.linkId === s.id);
  }

  private clearTransient() {
    this.radial.close();
    this.consolePanel.hide();
    this.cancelPathPick();
    this.incidents.stop();
    this.clearFilter();
  }

  // ── selection & panel ──

  select(sel: Selection | null, opts: { focus?: boolean } = {}) {
    const same = sel && this.selection && sel.kind === this.selection.kind && sel.id === this.selection.id;
    this.selection = sel;
    this.world.select(sel);
    if (!sel) {
      if (this.panelMode === 'selection') this.closePanel(false);
      return;
    }
    if (!same) {
      const s = sel;
      const top = s.kind === 'device' ? this.world.devices.get(s.id)!.top : 0;
      const radius = s.kind === 'device' ? 2.8 * this.model.devices.get(s.id)!.scale : s.kind === 'rack' ? 3.4 : s.kind === 'site' ? 46 : 1;
      const center = () => this.world.worldPosOf(s).add(new THREE.Vector3(0, top, 0));
      const right = new THREE.Vector3();
      this.anchorFn = {
        center,
        edge: () => center().addScaledVector(right.setFromMatrixColumn(this.world.rig.camera.matrixWorld, 0), radius),
      };
    }
    this.panelMode = 'selection';
    this.panel.show(renderSelection(this.model, sel), this.anchorFn);
    if (opts.focus) void this.world.focusOn(sel);
    sound.click();
  }

  private closePanel(clearSel = true) {
    if (this.panelMode === 'path') this.clearFilter();
    this.panelMode = null;
    this.panel.hide();
    if (clearSel && this.selection) {
      this.selection = null;
      this.world.select(null);
    }
  }

  private refreshPanel(full: boolean) {
    if (this.panelMode !== 'selection' || !this.selection) return;
    if (full) this.panel.show(renderSelection(this.model, this.selection), this.anchorFn);
    else applyLive(this.panel.body, liveSelection(this.model, this.selection));
  }

  zoomInto(sel: Selection) {
    this.goTo(this.world.viewFor(sel));
  }

  open(entry: SearchEntry) {
    if (entry.kind === 'vlan') return this.applyQuery(entry.label);
    if (entry.select) this.goTo(this.world.viewFor(entry.select));
  }

  openFilterItem(kind: 'device' | 'link' | 'alarm', id: string) {
    if (kind === 'alarm') {
      const a = this.model.topo.alarms.find((x) => x.id === id);
      if (a) this.focusAlarm(a);
      return;
    }
    const sel: Selection = { kind, id };
    this.select(sel, { focus: true });
  }

  private onPanelClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const q = <T extends string>(attr: T) => t.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr);
    const copy = q('data-copy');
    if (copy) return this.copy(copy);
    const query = q('data-query');
    if (query) return this.applyQuery(query);
    const act = q('data-act');
    const sel = this.selection;
    if (act) {
      if (act === 'clear-path') return this.clearFilter();
      if (act === 'reverse-path' && this.path?.ok) return this.trace(this.path.to!.id, this.path.from!.id);
      if (!sel) return;
      if (act === 'zoom') return this.zoomInto(sel);
      if (sel.kind === 'device') {
        if (act === 'trace') return this.startPathPick(sel.id);
        if (act === 'neighbours') return this.neighbours(sel.id);
        if (act === 'show') return this.showCmd(sel.id);
        if (act === 'ssh') return this.ssh(sel.id);
      }
      if (act === 'trace-link' && sel.kind === 'link') {
        const l = this.model.links.get(sel.id)!;
        return this.trace(l.a.deviceId, l.b.deviceId);
      }
      return;
    }
    const dev = q('data-goto-device');
    if (dev) return this.goTo({ level: 'device', deviceId: dev });
    const link = q('data-goto-link');
    if (link) return this.goTo({ level: 'link', linkId: link });
    const rack = q('data-goto-rack');
    if (rack) return this.goTo({ level: 'rack', siteId: this.model.racks.get(rack)!.siteId, rackId: rack });
    const alarm = q('data-alarm');
    if (alarm) {
      const a = this.model.topo.alarms.find((x) => x.id === alarm);
      if (a && !(sel?.kind === a.targetType && sel.id === a.targetId)) this.focusAlarm(a);
    }
  }

  // ── pointer input ──

  private bindPointer(canvas: HTMLCanvasElement) {
    let down: { x: number; y: number; t: number; button: number; type: string } | null = null;
    let longPress = 0;
    let hoverQueued = false;
    let lastMove = { x: 0, y: 0 };

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, type: e.pointerType };
      hideTip();
      if (e.pointerType === 'touch') {
        clearTimeout(longPress);
        longPress = window.setTimeout(() => {
          if (down) this.openRadialAt(down.x, down.y);
          down = null;
        }, 550);
      }
      this.wallboard.nudge();
    });
    canvas.addEventListener('pointermove', (e) => {
      lastMove = { x: e.clientX, y: e.clientY };
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) clearTimeout(longPress);
      if (down || e.pointerType === 'touch' || hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        this.hoverAt(lastMove.x, lastMove.y);
      });
    });
    canvas.addEventListener('pointerup', (e) => {
      clearTimeout(longPress);
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const dt = performance.now() - down.t;
      const d = down;
      down = null;
      if (moved > 6) return;
      if (d.button === 2) return this.openRadialAt(e.clientX, e.clientY);
      if (d.button === 0 && dt < 500) this.clickAt(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerleave', () => {
      hideTip();
      this.world.setHover(null);
      canvas.style.cursor = '';
    });
  }

  private clickAt(x: number, y: number) {
    const now = performance.now();
    // The first click starts re-centring the camera, so for a double-click reuse the first
    // click's target instead of re-picking under a moving camera.
    const isDouble = now - this.lastClick.t < 340 && Math.hypot(x - this.lastClick.x, y - this.lastClick.y) < 10 && !!this.lastClick.sel;
    const sel = isDouble ? this.lastClick.sel : this.world.pick(x, y);
    this.lastClick = { t: isDouble ? 0 : now, x, y, sel };
    if (this.pathPickFrom) {
      if (sel?.kind === 'device') this.trace(this.pathPickFrom, sel.id);
      return;
    }
    if (!sel) {
      if (this.panelMode === 'selection') this.select(null);
      return;
    }
    if (isDouble) this.zoomInto(sel);
    else this.select(sel, { focus: true });
  }

  private hoverAt(x: number, y: number) {
    const sel = this.world.pick(x, y);
    this.world.setHover(sel);
    this.world.renderer.domElement.style.cursor = sel ? (this.pathPickFrom && sel.kind === 'device' ? 'crosshair' : 'pointer') : '';
    if (!sel) return hideTip();
    showTip(this.tipFor(sel), x, y, true);
  }

  private tipFor(sel: Selection): string {
    const m = this.model;
    switch (sel.kind) {
      case 'device': {
        const d = m.devices.get(sel.id)!;
        const h = m.deviceHealth(d.id);
        return `<div class="tt-head"><b class="mono">${esc(d.hostname)}</b>${healthPill(h)}</div><div class="tt-sub">${esc(d.model)}</div><div class="tt-sub mono">${esc(d.ip)} · CPU ${d.reachable ? pct(d.cpu) : '—'}</div>${this.pathPickFrom ? '<div class="tt-hint">Click to trace path here</div>' : ''}`;
      }
      case 'link': {
        const l = m.links.get(sel.id)!;
        return `<div class="tt-head"><b class="mono">${esc(l.a.deviceId)} ↔ ${esc(l.b.deviceId)}</b></div><div class="tt-sub mono">${l.capacityGbps} Gb/s · ${l.status === 'down' ? 'DOWN' : pct(l.util)}${l.flapping ? ' · flapping' : ''}</div>`;
      }
      case 'site': {
        const s = m.sites.get(sel.id)!;
        const n = m.topo.alarms.filter((a) => a.siteId === s.id).length;
        return `<div class="tt-head"><b>${esc(s.name)}</b>${healthPill(m.siteHealth(s.id))}</div><div class="tt-sub">${n ? `${n} active alarm${n > 1 ? 's' : ''}` : 'No active alarms'} · double-click to enter</div>`;
      }
      case 'rack': {
        const r = m.racks.get(sel.id)!;
        return `<div class="tt-head"><b>${esc(r.name)}</b>${healthPill(m.rackHealth(r.id))}</div><div class="tt-sub">${m.devicesInRack(r.id).length} devices · double-click to enter</div>`;
      }
    }
  }

  // ── radial menu ──

  private openRadialAt(x: number, y: number) {
    const sel = this.world.pick(x, y);
    if (!sel) return;
    this.select(sel);
    const m = this.model;
    let title = '';
    let items: RadialItem[] = [];
    if (sel.kind === 'device') {
      const d = m.devices.get(sel.id)!;
      title = d.hostname;
      items = [
        { id: 'inspect', label: 'Inspect', icon: 'inspect', key: '↵', run: () => this.zoomInto(sel) },
        { id: 'trace', label: 'Trace path from here', icon: 'trace', key: 'T', disabled: !d.reachable, run: () => this.startPathPick(d.id) },
        { id: 'nb', label: 'Show neighbours', icon: 'neighbours', key: 'N', run: () => this.neighbours(d.id) },
        { id: 'show', label: 'Run show command', icon: 'terminal', key: 'C', run: () => this.showCmd(d.id) },
        { id: 'copy', label: 'Copy IP', icon: 'copy', key: 'Y', run: () => this.copy(d.ip) },
        { id: 'ssh', label: 'Open SSH session', icon: 'ssh', run: () => this.ssh(d.id) },
      ];
    } else if (sel.kind === 'site') {
      const s = m.sites.get(sel.id)!;
      title = s.name;
      items = [
        { id: 'enter', label: 'Enter site', icon: 'zoomIn', key: '↵', run: () => this.zoomInto(sel) },
        { id: 'alarms', label: 'Show alarms', icon: 'alarm', run: () => this.applyQuery(`alarms in ${s.name}`) },
        { id: 'wan', label: 'WAN links', icon: 'link', run: () => this.applyQuery(`wan links in ${s.name}`) },
        { id: 'fw', label: 'Firewalls', icon: 'firewall', run: () => this.applyQuery(`firewalls in ${s.name}`) },
        { id: 'copy', label: 'Copy site code', icon: 'copy', run: () => this.copy(s.code.toUpperCase()) },
      ];
    } else if (sel.kind === 'rack') {
      const r = m.racks.get(sel.id)!;
      const leaf = m.devicesInRack(r.id).find((d) => d.role === 'switch');
      title = r.name;
      items = [
        { id: 'enter', label: 'Enter rack', icon: 'zoomIn', key: '↵', run: () => this.zoomInto(sel) },
        { id: 'leaf', label: 'Inspect leaf switch', icon: 'switch', disabled: !leaf, run: () => leaf && this.goTo({ level: 'device', deviceId: leaf.id }) },
        { id: 'nb', label: 'Leaf neighbours', icon: 'neighbours', disabled: !leaf, run: () => leaf && this.neighbours(leaf.id) },
        { id: 'copy', label: 'Copy rack name', icon: 'copy', run: () => this.copy(`${m.sites.get(r.siteId)!.code.toUpperCase()}-${r.name.replace('Rack ', '')}`) },
      ];
    } else {
      const l = m.links.get(sel.id)!;
      title = 'Link';
      items = [
        { id: 'inspect', label: 'Inspect', icon: 'inspect', key: '↵', run: () => this.zoomInto(sel) },
        { id: 'trace', label: 'Trace across link', icon: 'trace', disabled: l.status === 'down', run: () => this.trace(l.a.deviceId, l.b.deviceId) },
        { id: 'a', label: `Go to ${l.a.deviceId}`, icon: 'next', run: () => this.goTo({ level: 'device', deviceId: l.a.deviceId }) },
        { id: 'b', label: `Go to ${l.b.deviceId}`, icon: 'next', run: () => this.goTo({ level: 'device', deviceId: l.b.deviceId }) },
        { id: 'copy', label: 'Copy interfaces', icon: 'copy', run: () => this.copy(`${l.a.deviceId} ${l.a.iface} <-> ${l.b.deviceId} ${l.b.iface}`) },
      ];
    }
    this.radial.open(x, y, title, items);
    sound.click();
  }

  // ── actions ──

  private copy(text: string) {
    void navigator.clipboard?.writeText(text).then(
      () => toast(`Copied <span class="mono">${esc(text)}</span>`, { ms: 2000 }),
      () => toast(`Copy failed. Select manually: <span class="mono">${esc(text)}</span>`, { kind: 'warn' }),
    );
  }

  private ssh(deviceId: string) {
    const d = this.model.devices.get(deviceId)!;
    const cmd = `ssh admin@${d.ip}`;
    toast(`Opening SSH to <span class="mono">${esc(d.hostname)}</span> (${esc(d.ip)})…`, { action: { label: 'Copy command', run: () => this.copy(cmd) }, ms: 6000 });
    // Hands off to the OS ssh:// handler (e.g. a terminal app); harmless if none is registered.
    const a = document.createElement('a');
    a.href = `ssh://admin@${d.ip}`;
    a.click();
  }

  private showCmd(deviceId: string) {
    const d = this.model.devices.get(deviceId)!;
    // Optional command backend: ?cli=<url> receives a POST per command and returns plain text.
    const endpoint = new URLSearchParams(location.search).get('cli');
    const run: CommandRunner = endpoint
      ? async (command) => {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: d.id, hostname: d.hostname, ip: d.ip, command }),
          });
          if (!res.ok) throw new Error(`Command backend returned HTTP ${res.status}`);
          return res.text();
        }
      : (command) => showOutput(this.model, d, command);
    const banner = endpoint ? `Connected to command backend ${endpoint}. Type "help" for commands.` : 'Simulated output (no command backend configured). Type "help" for commands.';
    this.consolePanel.show(d.hostname, d.ip, showCommands(d), run, prefs.get('reducedMotion'), { banner });
  }

  private neighbours(deviceId: string) {
    const d = this.model.devices.get(deviceId)!;
    const nbs = this.model.neighbours(deviceId);
    this.setFilter({ label: `Neighbours of ${d.hostname} (${nbs.length})`, devices: [deviceId, ...nbs.map((n) => n.device.id)], links: nbs.map((n) => n.link.id) }, nbs.map((n) => ({ kind: 'device' as const, id: n.device.id, label: `${n.device.hostname} · ${n.remoteIface}` })));
  }

  private startPathPick(fromId: string) {
    const d = this.model.devices.get(fromId)!;
    this.pathPickFrom = fromId;
    this.hud.showBanner(`${icon('trace', 16)}<span>Tracing from <b class="mono">${esc(d.hostname)}</b>: click a destination device, or type it below</span><kbd>Esc</kbd>`);
    this.palette.open(`path from ${d.ip} to `);
  }

  private cancelPathPick() {
    if (!this.pathPickFrom) return;
    this.pathPickFrom = null;
    this.hud.hideBanner();
  }

  trace(from: string, to: string) {
    this.cancelPathPick();
    const p = tracePath(this.model, from, to);
    if (!p.ok) {
      toast(esc(p.error ?? 'No path'), { kind: 'warn' });
      return;
    }
    this.filter = null;
    this.hud.hideFilter();
    this.path = p;
    this.world.setPath(p);
    this.selection = null;
    this.world.select(null);
    this.panelMode = 'path';
    this.panel.show(this.renderPath(p), null);
    void this.world.frameSet(
      p.hops.map((h) => h.device.id),
      [],
      { biasLeft: innerWidth > 1100 ? 0.35 : 0 },
    );
    this.hud.pushEvent(`Path traced: ${esc(p.from!.hostname)} → ${esc(p.to!.hostname)} · ${p.hops.length - 1} hops`);
  }

  private renderPath(p: PathResult): string {
    const links = p.linkIds.map((id) => this.model.links.get(id)!);
    const bottleneck = Math.min(...links.map((l) => l.capacityGbps));
    const hottest = Math.max(...links.map((l) => l.util));
    return `
      <header class="ph"><div class="ph-icon path">${icon('trace', 22)}</div>
        <div class="ph-main"><div class="ph-title">Path trace</div><div class="ph-sub mono">${esc(p.from!.ip)} → ${esc(p.to!.ip)}</div></div>
        <span class="pill path">${p.hops.length - 1} hops</span></header>
      <section class="sec stats">
        <div class="stat"><label>Latency</label><b>~${p.latencyMs.toFixed(1)} ms</b></div>
        <div class="stat"><label>Bottleneck</label><b>${bottleneck} Gb/s</b></div>
        <div class="stat"><label>Hottest hop</label><b>${pct(hottest)}</b></div>
      </section>
      <ol class="hops">${p.hops
        .map((h, i) => {
          const site = this.model.sites.get(h.device.siteId)!;
          const via = h.via ? `<div class="hop-via"><span class="bar ${h.via.util >= 0.9 ? 'warn' : ''}"><span style="width:${Math.round(h.via.util * 100)}%"></span></span><span class="mono muted">${h.via.kind === 'wan' ? 'WAN ' : ''}${h.via.capacityGbps}G · ${pct(h.via.util)}</span></div>` : '';
          return `<li>${via}<button class="hop" data-goto-device="${h.device.id}"><span class="hop-n mono">${i}</span>${icon(h.device.role, 14)}<span class="mono">${esc(h.device.hostname)}</span><span class="muted mono">${esc([h.inIface, h.outIface].filter(Boolean).join(' → '))}</span><span class="muted">${esc(site.code.toUpperCase())}</span></button></li>`;
        })
        .join('')}</ol>
      <footer class="actions"><button class="btn" data-act="reverse-path">${icon('trace')} Reverse</button><button class="btn" data-act="clear-path">${icon('close')} Clear path</button></footer>`;
  }

  applyQuery(text: string) {
    const q = parseQuery(text, this.model);
    if (q?.kind === 'path') return this.trace(q.from, q.to);
    if (!q) {
      const hit = search(buildIndex(this.model), text, 1)[0];
      if (hit) this.open(hit);
      else toast(`Nothing matches “${esc(text)}”`, { kind: 'warn' });
      return;
    }
    const r = runFilter(q, this.model);
    const label = describeFilter(q, r, this.model);
    const items = [
      ...r.alarms.map((id) => ({ kind: 'alarm' as const, id, label: this.model.topo.alarms.find((a) => a.id === id)!.title, cls: 'alarm' })),
      ...(q.entity === 'alarms' ? [] : r.links.map((id) => ({ kind: 'link' as const, id, label: this.model.viewLabel({ level: 'link', linkId: id }) }))),
      ...(q.entity === 'alarms' ? [] : r.devices.map((id) => ({ kind: 'device' as const, id, label: this.model.devices.get(id)!.hostname }))),
    ];
    this.setFilter({ label, devices: r.devices, links: r.links }, items);
  }

  private setFilter(f: FilterState, items: { kind: 'device' | 'link' | 'alarm'; id: string; label: string; cls?: string }[]) {
    if (this.path) {
      this.path = null;
      this.world.setPath(null);
      if (this.panelMode === 'path') this.closePanel(false);
    }
    this.filter = f;
    this.world.setHighlight({ devices: new Set(f.devices), links: new Set(f.links) });
    this.hud.showFilter(f.label, items);
    if (f.devices.length || f.links.length) void this.world.frameSet(f.devices, f.links);
  }

  clearFilter() {
    const hadPath = !!this.path;
    this.filter = null;
    this.path = null;
    this.world.setPath(null);
    this.world.setHighlight(null);
    this.hud.hideFilter();
    if (hadPath && this.panelMode === 'path') {
      this.panelMode = null;
      this.panel.hide();
    }
  }

  private bookmark() {
    const name = this.model
      .breadcrumbs(this.view)
      .map((c) => c.label)
      .join(' › ');
    const b = { id: `bm-${Date.now().toString(36)}`, name, view: this.view, camera: this.world.rig.getState(), createdAt: Date.now() };
    prefs.set('bookmarks', [b, ...prefs.get('bookmarks')].slice(0, 20));
    toast(`${icon('bookmark', 14)} Bookmarked <b>${esc(name)}</b>`, { ms: 2500 });
  }

  restoreBookmark(id: string) {
    const b = prefs.get('bookmarks').find((x) => x.id === id);
    if (!b || !this.viewExists(b.view)) return;
    this.goTo(b.view);
    void this.world.rig.setState(b.camera, this.world.fx.camMs);
  }

  private saveCamera() {
    clearTimeout(this.camSaveTimer);
    this.camSaveTimer = window.setTimeout(() => prefs.set('lastCamera', this.world.rig.getState()), 500);
  }

  private cycleSibling(dir: number) {
    const m = this.model;
    const v = this.view;
    let list: string[];
    if (v.level === 'rack') list = m.devicesInRack(v.rackId).map((d) => d.id);
    else if (v.level === 'device') {
      const d = m.devices.get(v.deviceId)!;
      list = (d.rackId ? m.devicesInRack(d.rackId) : m.devicesInSite(d.siteId).filter((x) => x.tier !== 'endpoint')).map((x) => x.id);
    } else if (v.level === 'site') list = m.devicesInSite(v.siteId).filter((x) => x.tier !== 'endpoint').map((x) => x.id);
    else list = m.sortedAlarms().map((a) => (a.targetType === 'device' ? a.targetId : m.links.get(a.targetId)!.a.deviceId));
    if (!list.length) return;
    const cur = this.selection?.kind === 'device' ? list.indexOf(this.selection.id) : -1;
    const next = list[(cur + dir + list.length) % list.length];
    if (v.level === 'device') this.goTo({ level: 'device', deviceId: next });
    else this.select({ kind: 'device', id: next }, { focus: true });
  }

  // ── incidents / wallboard hosts ──

  incident() {
    if (this.incidents.active) return this.incidents.stop();
    this.clearFilter();
    if (!this.incidents.start(false)) toast('No active alarms. All systems nominal.', { ms: 2500 });
    else document.body.classList.add('incident-on');
  }

  focusAlarm(a: Alarm) {
    const sel: Selection = { kind: a.targetType, id: a.targetId };
    this.goTo(this.world.viewFor(sel));
  }

  onIncidentExit() {
    document.body.classList.remove('incident-on');
  }

  startIncidents(autoplay: boolean) {
    const ok = this.incidents.start(autoplay);
    document.body.classList.toggle('incident-on', ok);
    return ok;
  }

  stopIncidents() {
    this.incidents.stop();
  }

  setOrbit(on: boolean) {
    const c = this.world.rig.controls;
    c.autoRotate = on && !prefs.get('reducedMotion');
    c.autoRotateSpeed = 0.35;
  }

  toggleWallboard(force?: boolean) {
    const on = force ?? !this.wallboard.active;
    if (on === this.wallboard.active) return;
    if (on) {
      this.clearTransient();
      this.wallboard.start();
      toast(`Wallboard mode: cycling views. Press <kbd>W</kbd> to exit.`, { ms: 5000 });
    } else this.wallboard.stop();
    this.hud.setWallboard(on);
  }

  // ── toggles ──

  openPalette() {
    this.palette.open();
  }

  toggleLegend() {
    this.legend.toggle();
  }

  toggleSound() {
    prefs.set('sound', !prefs.get('sound'));
    toast(prefs.get('sound') ? 'Sound on' : 'Sound muted', { ms: 1500 });
  }

  toggleSettings() {
    this.settings.toggle();
  }

  toggleHelp() {
    this.help.toggle();
  }

  replayTour() {
    this.goTo({ level: 'global' });
    window.setTimeout(() => this.tour.start(), this.world.fx.camMs);
  }

  commands(): Command[] {
    const levels: EffectsLevel[] = ['ultra', 'balanced', 'performance'];
    return [
      { id: 'incident', label: 'Start incident mode', hint: 'alarms problems', key: 'I', icon: 'incident', run: () => this.incident() },
      { id: 'home', label: 'Go to global overview', hint: 'home', key: 'H', icon: 'home', run: () => this.home() },
      { id: 'bookmark', label: 'Bookmark this view', hint: 'save', key: 'B', icon: 'bookmark', run: () => this.bookmark() },
      { id: 'wall', label: 'Toggle wallboard mode', hint: 'noc tv screen', key: 'W', icon: 'wall', run: () => this.toggleWallboard() },
      { id: 'legend', label: 'Toggle legend', hint: 'key colours', key: 'L', icon: 'legend', run: () => this.toggleLegend() },
      { id: 'help', label: 'Keyboard shortcuts', hint: 'help keys', key: '?', icon: 'help', run: () => this.toggleHelp() },
      { id: 'settings', label: 'Open settings', hint: 'preferences theme', key: 'S', icon: 'settings', run: () => this.toggleSettings() },
      { id: 'a11y', label: 'Toggle accessibility mode', hint: 'colour blind reduced motion', key: 'A', icon: 'settings', run: () => setAccessibilityMode(!accessibilityMode()) },
      { id: 'sound', label: 'Toggle sound', hint: 'audio mute', key: 'M', icon: 'soundOn', run: () => this.toggleSound() },
      { id: 'tour', label: 'Replay guided tour', hint: 'help onboarding', icon: 'play', run: () => this.replayTour() },
      ...levels.map((l) => ({ id: `fx-${l}`, label: `Effects: ${l[0].toUpperCase()}${l.slice(1)}`, hint: l === 'performance' ? 'performance mode gpu' : 'graphics quality', icon: 'settings', run: () => (prefs.set('effectsPinned', true), prefs.set('effects', l)) })),
    ];
  }

  // ── keyboard ──

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        return this.palette.isOpen ? this.palette.close() : this.palette.open();
      }
      if (typing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Let focused controls handle their own activation keys (no double actions).
      if ((e.key === 'Enter' || e.key === ' ') && target.closest('button, a, summary, [role="menu"]')) return;
      this.wallboard.nudge();

      if (this.tour.isOpen) {
        if (e.key === 'Enter' || e.key === 'ArrowRight') {
          e.preventDefault();
          this.tour.next();
        } else if (e.key === 'Escape') this.tour.end();
        return;
      }
      if (this.incidents.active) {
        if (e.key === 'ArrowRight') return this.incidents.next();
        if (e.key === 'ArrowLeft') return this.incidents.prev();
        if (e.key === ' ') {
          e.preventDefault();
          return this.incidents.toggleAutoplay();
        }
      }
      const sel = this.selection;
      const k = e.key;
      const map: Record<string, () => void> = {
        Escape: () => this.back(),
        '/': () => this.palette.open(),
        '?': () => this.toggleHelp(),
        h: () => this.home(),
        Home: () => this.home(),
        Enter: () => sel && this.zoomInto(sel),
        f: () => (sel ? void this.world.focusOn(sel) : void this.world.goTo(this.view)),
        '[': () => this.cycleSibling(-1),
        ']': () => this.cycleSibling(1),
        t: () => sel?.kind === 'device' && this.startPathPick(sel.id),
        n: () => sel?.kind === 'device' && this.neighbours(sel.id),
        c: () => sel?.kind === 'device' && this.showCmd(sel.id),
        y: () => sel?.kind === 'device' && this.copy(this.model.devices.get(sel.id)!.ip),
        i: () => this.incident(),
        b: () => this.bookmark(),
        l: () => this.toggleLegend(),
        w: () => this.toggleWallboard(),
        s: () => this.toggleSettings(),
        m: () => this.toggleSound(),
        g: () => prefs.set('scanlines', !prefs.get('scanlines')),
        a: () => {
          setAccessibilityMode(!accessibilityMode());
          toast(accessibilityMode() ? 'Accessibility mode on' : 'Accessibility mode off', { ms: 1800 });
        },
        e: () => {
          const order: EffectsLevel[] = ['ultra', 'balanced', 'performance'];
          const next = order[(order.indexOf(prefs.get('effects')) + 1) % order.length];
          prefs.set('effectsPinned', true);
          prefs.set('effects', next);
          toast(`Effects: <b>${next}</b>`, { ms: 1500 });
        },
      };
      const fn = map[k] ?? map[k.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn();
        return;
      }
      if (/^[1-9]$/.test(k)) {
        const s = this.model.topo.sites.find((x) => x.index === +k);
        if (s) this.goTo({ level: 'site', siteId: s.id });
      }
    });
  }

  // ── model & prefs ──

  private bindModel() {
    let tick = 0;
    this.model.on('telemetry', () => {
      this.world.links.refresh(this.world.pal);
      this.refreshPanel(false);
      if (++tick % 15 === 0 && this.panelMode === 'path' && this.path) this.panel.show(this.renderPath(this.path), null);
    });
    const onAlarm = (a: Alarm, raised: boolean) => {
      this.world.refreshHealth();
      this.hud.setStatus();
      this.incidents.sync();
      this.refreshPanel(true);
      const p = palette();
      const glyph = raised ? (a.severity === 'critical' ? p.glyph.critical : p.glyph.warning) : p.glyph.ok;
      const site = this.model.sites.get(a.siteId)?.name ?? '';
      this.hud.pushEvent(`<span class="glyph">${glyph}</span> ${raised ? '' : 'Cleared: '}${esc(a.title)} <span class="muted">· ${esc(site)}</span>`, raised ? (a.severity === 'critical' ? 'crit' : 'warn') : 'ok');
      if (raised) sound.alarm(a.severity === 'critical');
    };
    this.model.on('alarm-raised', (a) => onAlarm(a, true));
    this.model.on('alarm-cleared', (a) => onAlarm(a, false));
  }

  private syncBodyClasses() {
    const b = document.body.classList;
    b.toggle('reduced-motion', prefs.get('reducedMotion'));
    b.toggle('effects-off', prefs.get('effectsOff'));
    b.toggle('scanlines', prefs.get('scanlines') && !prefs.get('effectsOff'));
    b.toggle('cb', prefs.get('colorBlind'));
    b.toggle('perf', prefs.get('effects') === 'performance');
  }

  private onPref(key: string) {
    this.syncBodyClasses();
    if (key === 'effects' || key === 'reducedMotion' || key === 'effectsOff') this.world.applyFx();
    if (key === 'colorBlind' || key === 'accent') {
      applyCssPalette();
      this.world.applyPalette();
      this.legend.render();
      this.legend.root.querySelector('[data-close]')?.addEventListener('click', () => this.legend.toggle(false));
      this.hud.setStatus();
      this.refreshPanel(true);
    }
    if (key === 'sound') {
      sound.sync();
      this.hud.syncToggles();
    }
    if (key === 'scanlines' && prefs.get('scanlines') && prefs.get('effectsOff')) toast('Scanlines are hidden while “Effects off” is on.', { ms: 2500 });
  }

  private onPerfLow(fps: number) {
    if (prefs.get('effectsPinned')) return;
    const cur = prefs.get('effects');
    const next: EffectsLevel | null = cur === 'ultra' ? 'balanced' : cur === 'balanced' ? 'performance' : null;
    if (!next) return;
    prefs.set('effects', next);
    toast(`Frame rate was low (${Math.round(fps)} fps), so effects are now <b>${next}</b>.`, {
      action: {
        label: `Keep ${cur}`,
        run: () => {
          prefs.set('effectsPinned', true);
          prefs.set('effects', cur);
        },
      },
      ms: 7000,
    });
  }
}
