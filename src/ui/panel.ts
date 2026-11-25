/**
 * Glassmorphism hologram panel anchored in 3D space next to the object it describes, with a
 * thin connector line back to the anchor. On narrow screens it becomes a bottom sheet.
 */
import type * as THREE from 'three';
import { el, icon } from './dom';

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

/** Docked glass terminal for simulated show commands. */
export class ConsolePanel {
  readonly root: HTMLDivElement;
  private out: HTMLPreElement;
  private tabs: HTMLDivElement;
  private title: HTMLDivElement;
  private typing = 0;

  constructor(host: HTMLElement) {
    this.root = el('div', 'console glass');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Command output');
    this.root.innerHTML = `<div class="console-head"><span class="console-icon">${icon('terminal', 14)}</span><div class="console-title"></div><button class="icon-btn small" aria-label="Close console">${icon('close', 14)}</button></div><div class="console-tabs"></div><pre class="console-out" tabindex="0"></pre>`;
    this.title = this.root.querySelector('.console-title')!;
    this.tabs = this.root.querySelector('.console-tabs')!;
    this.out = this.root.querySelector('.console-out')!;
    this.root.querySelector('button')!.onclick = () => this.hide();
    host.appendChild(this.root);
  }

  get open() {
    return this.root.classList.contains('open');
  }

  show(hostname: string, ip: string, commands: string[], run: (cmd: string) => string, instant: boolean) {
    this.title.innerHTML = `<span class="mono">${hostname}</span><span class="muted mono"> · ${ip}</span>`;
    this.tabs.innerHTML = '';
    const exec = (cmd: string) => {
      this.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.textContent === cmd));
      const text = `${hostname}# ${cmd}\n${run(cmd)}\n`;
      clearInterval(this.typing);
      if (instant) {
        this.out.textContent = text;
        return;
      }
      // Fast "typing" reveal (~250 ms) for a live-terminal feel, never blocking.
      let i = 0;
      const chunk = Math.max(8, Math.ceil(text.length / 16));
      this.out.textContent = '';
      this.typing = window.setInterval(() => {
        i += chunk;
        this.out.textContent = text.slice(0, i);
        if (i >= text.length) clearInterval(this.typing);
      }, 16);
    };
    for (const c of commands) {
      const b = el('button', 'tab mono', c);
      b.onclick = () => exec(c);
      this.tabs.appendChild(b);
    }
    this.root.classList.add('open');
    exec(commands[0]);
  }

  hide() {
    clearInterval(this.typing);
    this.root.classList.remove('open');
  }
}
