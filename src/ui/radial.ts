/** Right-click (or long-press) radial menu with quick actions for any object. */
import { esc } from '../core/util';
import { el, icon, kbd } from './dom';

export interface RadialItem {
  id: string;
  label: string;
  icon: string;
  key?: string;
  disabled?: boolean;
  run: () => void;
}

export class RadialMenu {
  readonly root: HTMLDivElement;
  private focus = -1;

  constructor(host: HTMLElement) {
    this.root = el('div', 'radial');
    this.root.setAttribute('role', 'menu');
    host.appendChild(this.root);
    this.root.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !this.root.contains(e.target as Node)) this.close();
    });
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  open(x: number, y: number, title: string, items: RadialItem[]) {
    const R = 92;
    const n = items.length;
    const cx = Math.min(Math.max(x, R + 70), innerWidth - R - 70);
    const cy = Math.min(Math.max(y, R + 70), innerHeight - R - 70);
    this.root.style.left = `${cx}px`;
    this.root.style.top = `${cy}px`;
    this.root.innerHTML = `<div class="radial-hub glass"><span>${esc(title)}</span></div>`;
    items.forEach((it, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const b = el('button', 'radial-item glass', `${icon(it.icon, 18)}<span class="radial-label">${esc(it.label)}${it.key ? ` ${kbd(it.key)}` : ''}</span>`);
      b.setAttribute('role', 'menuitem');
      b.disabled = !!it.disabled;
      b.style.setProperty('--x', `${Math.cos(a) * R}px`);
      b.style.setProperty('--y', `${Math.sin(a) * R}px`);
      b.style.setProperty('--d', `${i * 22}ms`);
      b.classList.toggle('left', Math.cos(a) < -0.2);
      b.onclick = () => {
        this.close();
        it.run();
      };
      this.root.appendChild(b);
    });
    this.root.classList.add('open');
    this.focus = -1;
    this.root.querySelector<HTMLButtonElement>('.radial-item')?.focus({ preventScroll: true });
  }

  close() {
    this.root.classList.remove('open');
  }

  private onKey(e: KeyboardEvent) {
    const btns = [...this.root.querySelectorAll<HTMLButtonElement>('.radial-item')];
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Tab') {
      e.preventDefault();
      this.focus = (this.focus + 1 + btns.length) % btns.length;
      btns[this.focus].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.focus = (this.focus - 1 + btns.length) % btns.length;
      btns[this.focus].focus();
    }
  }
}
