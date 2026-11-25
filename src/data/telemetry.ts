/**
 * Simulated live telemetry stream for demo mode. Updates utilisation and CPU every second and
 * occasionally raises (and later clears) a transient alarm, so the scene always feels alive.
 * A real deployment would replace this with a WebSocket/SSE adapter that mutates the same Model.
 */
import { clamp, rng } from '../core/util';
import type { Model } from './model';
import type { Device } from './types';

export class TelemetrySim {
  private timer = 0;
  private r = rng(1337);
  private baseUtil = new Map<string, number>();
  private pinned = new Set<string>();
  private nextEventAt = Date.now() + 25_000;

  constructor(private model: Model) {}

  start(intervalMs = 1000) {
    for (const l of this.model.topo.links) this.baseUtil.set(l.id, l.util);
    // Links that are part of a seeded alarm keep their value (e.g. congested WAN link).
    for (const a of this.model.topo.alarms) if (a.targetType === 'link') this.pinned.add(a.targetId);
    this.timer = window.setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    clearInterval(this.timer);
  }

  tick(now = Date.now()) {
    const { r } = this;
    const wave = 0.06 * Math.sin(now / 9000);
    for (const l of this.model.topo.links) {
      if (l.status === 'down') {
        l.util = 0;
        continue;
      }
      const base = this.baseUtil.get(l.id) ?? 0.3;
      if (this.pinned.has(l.id) && l.util >= 0.9) {
        l.util = clamp(0.93 + (r() - 0.5) * 0.04, 0.9, 0.98);
      } else {
        const target = clamp(base + wave + (r() - 0.5) * 0.2, 0.02, 0.88);
        l.util = clamp(l.util + (target - l.util) * 0.35, 0, 0.98);
      }
      if (l.flapping && r() < 0.15) l.flaps++;
    }
    for (const d of this.model.topo.devices) {
      if (!d.reachable) continue;
      const target = clamp(d.cpu + (r() - 0.5) * 0.06, 0.03, 0.97);
      d.cpu = target;
      d.mem = clamp(d.mem + (r() - 0.5) * 0.01, 0.1, 0.95);
      d.cpuHistory.push(d.cpu);
      if (d.cpuHistory.length > 60) d.cpuHistory.shift();
    }
    if (now >= this.nextEventAt) this.randomEvent(now);
    this.model.emit('telemetry', { now });
  }

  /** Raise a short-lived, self-clearing warning on a random healthy device. */
  private randomEvent(now: number) {
    this.nextEventAt = now + 45_000 + this.r() * 45_000;
    const candidates = this.model.topo.devices.filter((d) => d.reachable && d.role !== 'ap' && this.model.alarmsFor(d.id).length === 0);
    if (!candidates.length) return;
    const d: Device = candidates[Math.floor(this.r() * candidates.length)];
    d.cpu = 0.9;
    const alarm = this.model.raise({
      severity: 'warning',
      targetType: 'device',
      targetId: d.id,
      siteId: d.siteId,
      title: `High CPU on ${d.hostname} (90%)`,
      explanation: `${d.hostname} control-plane CPU has spiked above 90%. A short spike is usually harmless (a routing update or log burst). If it lasts more than 5 minutes, protocol timers can start to expire.`,
      action: `Run "show processes cpu sorted" on ${d.hostname}.`,
      raisedAt: now,
    });
    window.setTimeout(() => {
      d.cpu = 0.35;
      this.model.clear(alarm.id);
    }, 30_000 + this.r() * 30_000);
  }
}
