/**
 * Glassmorphism hologram panel anchored in 3D space next to the object it describes, with a
 * thin connector line back to the anchor. On narrow screens it becomes a bottom sheet.
 */
import type * as THREE from 'three';
import { el, icon } from './dom';
import { esc } from '../core/util';
import { BUILTINS, complete, resolveCommand } from '../core/cli';

/** Where a panel attaches: the object's centre, and a point on its right-hand silhouette edge. */
export interface Anchor {
  center(): THREE.Vector3;
  edge(): THREE.Vector3;
}

export class AnchoredPanel {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private svg: SVGSVGElement;
  private line: SVGLineElement;
  private dot: SVGCircleElement;
  private anchor: Anchor | null = null;
  private x = -1;
  private y = -1;
  open = false;
  onClose: (() => void) | null = null;

  constructor(
    host: HTMLElement,
    private project: (v: THREE.Vector3) => { x: number; y: number; visible: boolean },
    cls = '',
  ) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('connector');
    this.line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.dot.setAttribute('r', '3.5');
    this.svg.append(this.line, this.dot);
    host.appendChild(this.svg);

    this.root = el('div', `holo-panel glass ${cls}`);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Inspector');
    const close = el('button', 'icon-btn panel-close', icon('close', 14));
    close.setAttribute('aria-label', 'Close panel (Esc)');
    close.dataset.tip = 'Close';
    close.dataset.key = 'Esc';
    close.onclick = () => this.onClose?.();
    this.body = el('div', 'panel-body');
    this.root.append(close, this.body);
    host.appendChild(this.root);
  }

  show(html: string, anchor: Anchor | null) {
    const openDetails = new Set([...this.body.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.key));
    const sameAnchor = this.open && this.anchor === anchor;
    this.body.innerHTML = html;
    // Preserve progressive-disclosure state across re-renders of the same object.
    if (sameAnchor) this.body.querySelectorAll<HTMLDetailsElement>('details').forEach((d) => d.dataset.key && openDetails.has(d.dataset.key) && (d.open = true));
    this.anchor = anchor;
    if (!this.open) {
      this.open = true;
      this.x = this.y = -1;
      this.root.classList.remove('closing');
      this.root.classList.add('open');
      this.svg.classList.add('open');
    }
  }

  setAnchor(anchor: Anchor | null) {
    this.anchor = anchor;
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    this.svg.classList.remove('open');
  }

  get isSheet() {
    return innerWidth < 760;
  }

  private place(tx: number, ty: number, dt: number) {
    if (this.x < 0) {
      this.x = tx;
      this.y = ty;
    } else {
      const k = Math.min(1, dt / 0.09);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    this.root.style.transform = `translate3d(${Math.round(this.x)}px, ${Math.round(this.y)}px, 0)`;
  }

  /** Called every frame: keep the panel beside its anchor, easing towards the target spot. */
  update(dt: number) {
    if (!this.open) return;
    const sheet = this.isSheet;
    this.root.classList.toggle('sheet', sheet);
    if (sheet) {
      this.root.style.transform = '';
      this.svg.style.opacity = '0';
      return;
    }
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    const top = 76;
    // Keep clear of the incident card when it is showing.
    const card = document.querySelector('.incident.open');
    const bottom = Math.min(innerHeight - 64, card ? card.getBoundingClientRect().top - 12 : Infinity);
    if (!this.anchor) {
      // Unanchored content (e.g. a path trace) docks on the right.
      this.place(innerWidth - w - 20, top, dt);
      this.svg.style.opacity = '0';
      return;
    }
    const a = this.project(this.anchor.center());
    const e = this.project(this.anchor.edge());
    // Keep clear of the object's on-screen footprint, not just its centre point.
    const gap = Math.min(innerWidth * 0.3, Math.max(48, Math.hypot(e.x - a.x, e.y - a.y) + 28));
    let tx: number;
    let ty: number;
    let docked = false;
    if (!a.visible || a.x < 0 || a.x > innerWidth || a.y < 0 || a.y > innerHeight) {
      docked = true;
      tx = innerWidth - w - 20;
      ty = top;
    } else {
      tx = a.x + gap;
      if (tx + w > innerWidth - 16) tx = a.x - gap - w;
      if (tx < 16) tx = innerWidth - w - 20;
      ty = Math.min(Math.max(a.y - h * 0.35, top), Math.max(top, bottom - h));
    }
    this.place(tx, ty, dt);
    if (docked) {
      this.svg.style.opacity = '0';
      return;
    }
    this.svg.style.opacity = '1';
    const edgeX = this.x > a.x ? this.x : this.x + w;
    const edgeY = Math.min(Math.max(a.y, this.y + 24), this.y + h - 24);
    this.line.setAttribute('x1', String(a.x));
    this.line.setAttribute('y1', String(a.y));
    this.line.setAttribute('x2', String(edgeX));
    this.line.setAttribute('y2', String(edgeY));
    this.dot.setAttribute('cx', String(a.x));
    this.dot.setAttribute('cy', String(a.y));
  }
}

/** Runs one resolved command; may be async (e.g. a backend call). */
export type CommandRunner = (cmd: string) => string | Promise<string>;

/**
 * Docked glass terminal: a scrolling transcript with a typed command line.
 * Supports abbreviations ("sh int br"), Tab completion, ↑/↓ history and built-ins
 * (help, clear, history, exit). The quick-command tabs run through the same path.
 */
export class ConsolePanel {
  readonly root: HTMLDivElement;
  private out: HTMLDivElement;
  private tabs: HTMLDivElement;
  private title: HTMLDivElement;
  private prompt: HTMLSpanElement;
  private input: HTMLInputElement;
  private typing = 0;
  private hostname = '';
  private commands: string[] = [];
  private run: CommandRunner = () => '';
  private instant = false;
  private history: string[] = [];
  private histIndex = -1;
  private draft = '';
  private busy = false;

  constructor(host: HTMLElement) {
    this.root = el('div', 'console glass');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Device console');
    this.root.innerHTML = `
      <div class="console-head"><span class="console-icon">${icon('terminal', 14)}</span><div class="console-title"></div><button class="icon-btn small" aria-label="Close console" data-tip="Close" data-key="Esc">${icon('close', 14)}</button></div>
      <div class="console-tabs"></div>
      <div class="console-out" role="log" aria-live="polite" tabindex="0"></div>
      <label class="console-line"><span class="console-prompt mono"></span><input class="console-input mono" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Command" placeholder="type a command · Tab completes · help" /></label>`;
    this.title = this.root.querySelector('.console-title')!;
    this.tabs = this.root.querySelector('.console-tabs')!;
    this.out = this.root.querySelector('.console-out')!;
    this.prompt = this.root.querySelector('.console-prompt')!;
    this.input = this.root.querySelector('.console-input')!;
    this.root.querySelector('button')!.onclick = () => this.hide();
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    // Clicking anywhere in the transcript (without selecting text) focuses the prompt.
    this.out.addEventListener('mouseup', () => {
      if (!window.getSelection()?.toString()) this.input.focus();
    });
    host.appendChild(this.root);
  }

  get open() {
    return this.root.classList.contains('open');
  }

  /** Open the console for a device. Switching devices starts a fresh transcript. */
  show(hostname: string, ip: string, commands: string[], run: CommandRunner, instant: boolean, opts: { autorun?: boolean; banner?: string } = {}) {
    const sameDevice = this.open && hostname === this.hostname;
    this.hostname = hostname;
    this.commands = commands;
    this.run = run;
    this.instant = instant;
    this.title.innerHTML = `<span class="mono">${esc(hostname)}</span><span class="muted mono"> · ${esc(ip)}</span>`;
    this.prompt.textContent = `${hostname}#`;
    this.tabs.innerHTML = '';
    for (const c of commands) {
      const b = el('button', 'tab mono');
      b.textContent = c;
      b.onclick = () => void this.exec(c);
      this.tabs.appendChild(b);
    }
    this.root.classList.add('open');
    if (!sameDevice) {
      clearInterval(this.typing);
      this.out.innerHTML = '';
      if (opts.banner) this.print(opts.banner, 'cl-note');
      if (opts.autorun !== false) void this.exec(commands[0]);
    }
    this.input.focus({ preventScroll: true });
  }

  hide() {
    clearInterval(this.typing);
    this.root.classList.remove('open');
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  private print(text: string, cls: string, animate = false): HTMLPreElement {
    const block = el('pre', `cl-block ${cls}`);
    this.out.appendChild(block);
    // Keep the transcript bounded.
    while (this.out.childElementCount > 300) this.out.firstElementChild!.remove();
    if (!animate || this.instant) {
      block.textContent = text;
      this.out.scrollTop = this.out.scrollHeight;
      return block;
    }
    // Fast reveal (~250 ms) for a live-terminal feel; never blocks typing.
    clearInterval(this.typing);
    let i = 0;
    const chunk = Math.max(8, Math.ceil(text.length / 16));
    this.typing = window.setInterval(() => {
      i += chunk;
      block.textContent = text.slice(0, i);
      this.out.scrollTop = this.out.scrollHeight;
      if (i >= text.length) clearInterval(this.typing);
    }, 16);
    return block;
  }

  private async exec(raw: string) {
    const typed = raw.trim();
    this.print(`${this.hostname}# ${typed}`, 'cl-cmd');
    if (!typed) return;
    if (this.history.at(-1) !== typed) this.history.push(typed);
    if (this.history.length > 100) this.history.shift();
    this.histIndex = -1;

    const word = typed.toLowerCase();
    if (word === 'help' || word === '?') {
      const list = this.commands.map((c) => `  ${c}`).join('\n');
      return void this.print(`Available commands:\n${list}\n\nBuilt-ins: help, clear, history, exit\nAbbreviations work: "sh int br". Tab completes, ↑/↓ recall history.`, 'cl-out');
    }
    if (word === 'clear' || word === 'cls') return void (this.out.innerHTML = '');
    if (word === 'history') return void this.print(this.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'), 'cl-out');
    if (word === 'exit' || word === 'quit' || word === 'logout') return this.hide();

    const r = resolveCommand(typed, this.commands);
    if (!r.ok) return void this.print(r.error, 'cl-err');
    this.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.textContent === r.cmd));
    const pending = this.print('…', 'cl-out cl-pending');
    this.busy = true;
    try {
      const text = await this.run(r.cmd);
      pending.remove();
      this.print(text, 'cl-out', true);
    } catch (err) {
      pending.remove();
      this.print(`% ${(err as Error).message || 'Command failed'}`, 'cl-err');
    } finally {
      this.busy = false;
    }
  }

  private onKey(e: KeyboardEvent) {
    const inp = this.input;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.busy) return;
      const v = inp.value;
      inp.value = '';
      void this.exec(v);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const c = complete(inp.value, [...this.commands, ...BUILTINS]);
      inp.value = c.value;
      if (c.options.length) this.print(c.options.join('    '), 'cl-note');
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.history.length) return;
      if (this.histIndex === -1) this.draft = inp.value;
      const n = this.history.length;
      if (e.key === 'ArrowUp') this.histIndex = this.histIndex === -1 ? n - 1 : Math.max(0, this.histIndex - 1);
      else this.histIndex = this.histIndex === -1 ? -1 : this.histIndex + 1 >= n ? -1 : this.histIndex + 1;
      inp.value = this.histIndex === -1 ? this.draft : this.history[this.histIndex];
      requestAnimationFrame(() => inp.setSelectionRange(inp.value.length, inp.value.length));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      this.out.innerHTML = '';
    } else if (e.key === '?' && !inp.value.trim()) {
      // Network-OS habit: a bare "?" lists commands immediately.
      e.preventDefault();
      void this.exec('?');
    }
  }
}
