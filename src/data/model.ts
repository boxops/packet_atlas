/**
 * Indexed, queryable view over a Topology, plus derived health. All UI and scene code reads
 * the network through this class.
 */
import { Emitter } from '../core/util';
import type { Alarm, Device, Health, Link, Rack, Severity, Site, Topology, ViewTarget } from './types';

export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, major: 2, warning: 1 };
export const HEALTH_RANK: Record<Health, number> = { ok: 0, warning: 1, critical: 2, unreachable: 3 };

export function severityToHealth(s: Severity): Health {
  return s === 'critical' ? 'critical' : 'warning';
}

export function worstHealth(list: Health[]): Health {
  let worst: Health = 'ok';
  for (const h of list) {
    // For roll-ups, "critical" outranks "unreachable" visually (one ghost shouldn't hide a fire).
    const rank = h === 'unreachable' ? 1.5 : HEALTH_RANK[h];
    const wr = worst === 'unreachable' ? 1.5 : HEALTH_RANK[worst];
    if (rank > wr) worst = h;
  }
  return worst;
}

export type ModelEvents = {
  telemetry: { now: number };
  'alarm-raised': Alarm;
  'alarm-cleared': Alarm;
  'topology-loaded': Topology;
};

export class Model extends Emitter<ModelEvents> {
  topo: Topology = { sites: [], devices: [], links: [], alarms: [] };
  sites = new Map<string, Site>();
  racks = new Map<string, Rack>();
  devices = new Map<string, Device>();
  links = new Map<string, Link>();
  private deviceLinks = new Map<string, Link[]>();
  private byIp = new Map<string, Device>();
  private byMac = new Map<string, Device>();
  private byHost = new Map<string, Device>();

  load(t: Topology) {
    this.topo = t;
    this.sites = new Map(t.sites.map((s) => [s.id, s]));
    this.racks = new Map(t.sites.flatMap((s) => s.racks).map((r) => [r.id, r]));
    this.devices = new Map(t.devices.map((d) => [d.id, d]));
    this.links = new Map(t.links.map((l) => [l.id, l]));
    this.deviceLinks.clear();
    for (const l of t.links) {
      for (const end of [l.a, l.b]) {
        const arr = this.deviceLinks.get(end.deviceId) ?? [];
        arr.push(l);
        this.deviceLinks.set(end.deviceId, arr);
      }
    }
    this.byIp = new Map(t.devices.map((d) => [d.ip, d]));
    this.byMac = new Map(t.devices.map((d) => [d.mac.toLowerCase(), d]));
    this.byHost = new Map(t.devices.map((d) => [d.hostname.toLowerCase(), d]));
    this.emit('topology-loaded', t);
  }

  get isEmpty() {
    return this.topo.devices.length === 0;
  }

  linksOf(deviceId: string): Link[] {
    return this.deviceLinks.get(deviceId) ?? [];
  }

  peer(link: Link, deviceId: string) {
    return link.a.deviceId === deviceId ? link.b : link.a;
  }

  neighbours(deviceId: string): { device: Device; link: Link; localIface: string; remoteIface: string }[] {
    return this.linksOf(deviceId).map((link) => {
      const local = link.a.deviceId === deviceId ? link.a : link.b;
      const remote = this.peer(link, deviceId);
      return { device: this.devices.get(remote.deviceId)!, link, localIface: local.iface, remoteIface: remote.iface };
    });
  }

  devicesInSite(siteId: string) {
    return this.topo.devices.filter((d) => d.siteId === siteId);
  }

  devicesInRack(rackId: string) {
    return this.topo.devices.filter((d) => d.rackId === rackId);
  }

  findDevice(q: string): Device | undefined {
    const k = q.trim().toLowerCase();
    return this.byIp.get(k) ?? this.byMac.get(k) ?? this.byHost.get(k) ?? this.devices.get(k);
  }

  findSite(q: string): Site | undefined {
    const k = q.trim().toLowerCase();
    return this.topo.sites.find(
      (s) => s.name.toLowerCase() === k || s.code === k || s.aliases.includes(k) || s.name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '') === k,
    );
  }

  linkSites(l: Link): string[] {
    const a = this.devices.get(l.a.deviceId)!.siteId;
    const b = this.devices.get(l.b.deviceId)!.siteId;
    return a === b ? [a] : [a, b];
  }

  // ── alarms & health ──

  alarmsFor(targetId: string): Alarm[] {
    return this.topo.alarms.filter((a) => a.targetId === targetId);
  }

  /** Active alarms ordered by priority: severity, then most recent first. */
  sortedAlarms(): Alarm[] {
    return [...this.topo.alarms].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.raisedAt - a.raisedAt);
  }

  deviceHealth(id: string): Health {
    const d = this.devices.get(id);
    if (!d) return 'ok';
    if (!d.reachable) return 'unreachable';
    const own = this.alarmsFor(id).map((a) => severityToHealth(a.severity));
    // A problem on an attached link degrades the device (it lost redundancy or capacity).
    const viaLinks = this.linksOf(id).some((l) => l.status === 'down' || l.flapping || this.alarmsFor(l.id).length) ? (['warning'] as Health[]) : [];
    return worstHealth([...own, ...viaLinks]);
  }

  linkHealth(id: string): Health {
    const l = this.links.get(id);
    if (!l) return 'ok';
    const fromAlarms = worstHealth(this.alarmsFor(id).map((a) => severityToHealth(a.severity)));
    if (l.status === 'down') return 'critical';
    if (l.flapping || l.util >= 0.9) return worstHealth([fromAlarms, 'warning']);
    return fromAlarms;
  }

  siteHealth(siteId: string): Health {
    return worstHealth(this.topo.alarms.filter((a) => a.siteId === siteId).map((a) => severityToHealth(a.severity)));
  }

  rackHealth(rackId: string): Health {
    return worstHealth(this.devicesInRack(rackId).map((d) => this.deviceHealth(d.id)));
  }

  summary() {
    const s = { critical: 0, major: 0, warning: 0, unreachable: 0, linksDown: 0 };
    for (const a of this.topo.alarms) s[a.severity]++;
    for (const d of this.topo.devices) if (!d.reachable) s.unreachable++;
    for (const l of this.topo.links) if (l.status === 'down') s.linksDown++;
    return s;
  }

  raise(alarm: Omit<Alarm, 'id'>): Alarm {
    const a: Alarm = { ...alarm, id: `alarm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}` };
    this.topo.alarms.push(a);
    this.emit('alarm-raised', a);
    return a;
  }

  clear(alarmId: string) {
    const i = this.topo.alarms.findIndex((a) => a.id === alarmId);
    if (i < 0) return;
    const [a] = this.topo.alarms.splice(i, 1);
    this.emit('alarm-cleared', a);
  }

  // ── navigation helpers ──

  /** Parent level for "Esc steps back out one level". */
  parentView(v: ViewTarget): ViewTarget | null {
    switch (v.level) {
      case 'global':
        return null;
      case 'site':
        return { level: 'global' };
      case 'rack':
        return { level: 'site', siteId: v.siteId };
      case 'device': {
        const d = this.devices.get(v.deviceId);
        if (!d) return { level: 'global' };
        return d.rackId ? { level: 'rack', siteId: d.siteId, rackId: d.rackId } : { level: 'site', siteId: d.siteId };
      }
      case 'link': {
        const sites = this.linkSites(this.links.get(v.linkId)!);
        return sites.length === 1 ? { level: 'site', siteId: sites[0] } : { level: 'global' };
      }
    }
  }

  /** Breadcrumb trail, e.g. Global > London > Rack A3 > lon-leaf-03. */
  breadcrumbs(v: ViewTarget): { label: string; view: ViewTarget }[] {
    const trail: { label: string; view: ViewTarget }[] = [];
    let cur: ViewTarget | null = v;
    while (cur) {
      trail.unshift({ label: this.viewLabel(cur), view: cur });
      cur = this.parentView(cur);
    }
    return trail;
  }

  viewLabel(v: ViewTarget): string {
    switch (v.level) {
      case 'global':
        return 'Global';
      case 'site':
        return this.sites.get(v.siteId)?.name ?? v.siteId;
      case 'rack':
        return this.racks.get(v.rackId)?.name ?? v.rackId;
      case 'device':
        return this.devices.get(v.deviceId)?.hostname ?? v.deviceId;
      case 'link': {
        const l = this.links.get(v.linkId);
        return l ? `${l.a.deviceId} ↔ ${l.b.deviceId}` : v.linkId;
      }
    }
  }
}
