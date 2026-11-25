/**
 * Wallboard mode for NOC wall screens: large type, minimal chrome, and an unattended cycle of
 * global overview → active incidents → each site. Any interaction pauses it for 45 s.
 */
import type { Model } from '../data/model';
import type { ViewTarget } from '../data/types';

export interface WallboardHost {
  goTo(v: ViewTarget): void;
  startIncidents(autoplay: boolean): boolean;
  stopIncidents(): void;
  setOrbit(on: boolean): void;
}

type Step = { kind: 'view'; view: ViewTarget; ms: number } | { kind: 'incidents'; ms: number };

export class Wallboard {
  active = false;
  private timer = 0;
  private step = 0;
  private pausedUntil = 0;

  constructor(
    private model: Model,
    private app: WallboardHost,
  ) {}

  private plan(): Step[] {
    const steps: Step[] = [{ kind: 'view', view: { level: 'global' }, ms: 20_000 }];
    const alarms = this.model.topo.alarms.length;
    if (alarms) steps.push({ kind: 'incidents', ms: Math.min(alarms, 8) * 9_000 });
    for (const s of this.model.topo.sites) steps.push({ kind: 'view', view: { level: 'site', siteId: s.id }, ms: 8_000 });
    return steps;
  }

  start() {
    this.active = true;
    document.body.classList.add('wallboard');
    this.step = 0;
    this.run();
  }

  stop() {
    this.active = false;
    clearTimeout(this.timer);
    document.body.classList.remove('wallboard');
    this.app.setOrbit(false);
    this.app.stopIncidents();
  }

  /** User interaction: hold the current view for a while before resuming the cycle. */
  nudge() {
    if (!this.active) return;
    this.pausedUntil = Date.now() + 45_000;
    this.app.setOrbit(false);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), 45_000);
  }

  private run(): void {
    if (!this.active) return;
    if (Date.now() < this.pausedUntil) return;
    const plan = this.plan();
    const s = plan[this.step % plan.length];
    this.step++;
    this.app.stopIncidents();
    if (s.kind === 'view') {
      this.app.goTo(s.view);
      this.app.setOrbit(true);
    } else {
      this.app.setOrbit(false);
      if (!this.app.startIncidents(true)) return this.run();
    }
    this.timer = window.setTimeout(() => this.run(), s.ms);
  }
}
