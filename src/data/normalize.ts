/**
 * Accept a minimal Topology from a real data source and fill in everything the scene needs:
 * site/rack/device positions (auto-layout by tier), interface lists derived from links, and
 * neutral telemetry defaults. See docs/DATA_MODEL.md.
 */
import { SITE_RADIUS, TIER_Y } from './mock';
import type { Alarm, Device, Link, Rack, Role, Site, Tier, Topology } from './types';

type Partial2<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type DeviceInput = Partial2<Device, 'x' | 'y' | 'z' | 'scale' | 'interfaces' | 'cpu' | 'mem' | 'cpuHistory' | 'bootedAt' | 'reachable' | 'flapping' | 'vlans' | 'model' | 'os' | 'serial' | 'mac' | 'tier'>;
export type SiteInput = Partial2<Omit<Site, 'racks'>, 'x' | 'z' | 'aliases' | 'index' | 'region' | 'code'> & { racks?: Partial2<Rack, 'x' | 'z' | 'siteId'>[] };
export type LinkInput = Partial2<Link, 'util' | 'status' | 'flapping' | 'flaps' | 'errors' | 'kind'>;

export interface TopologyInput {
  sites: SiteInput[];
  devices: DeviceInput[];
  links: LinkInput[];
  alarms?: Alarm[];
}

const DEFAULT_TIER: Record<Role, Tier> = { router: 'core', firewall: 'distribution', switch: 'access', ap: 'endpoint', server: 'endpoint' };

export function normalizeTopology(input: TopologyInput): Topology {
  const n = input.sites.length;
  const spacing = 230;
  const cols = Math.ceil(Math.sqrt(n));

  const sites: Site[] = input.sites.map((s, i) => {
    const code = s.code ?? s.name.slice(0, 3).toLowerCase();
    const racks: Rack[] = (s.racks ?? []).map((r, ri, arr) => ({
      ...r,
      siteId: s.id,
      x: r.x ?? (ri - (arr.length - 1) / 2) * 14,
      z: r.z ?? 14,
    }));
    return {
      ...s,
      code,
      region: s.region ?? '',
      index: s.index ?? i + 1,
      aliases: s.aliases ?? [],
      // Grid layout when no coordinates are supplied.
      x: s.x ?? ((i % cols) - (cols - 1) / 2) * spacing,
      z: s.z ?? (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * spacing,
      racks,
    };
  });
  const rackById = new Map(sites.flatMap((s) => s.racks).map((r) => [r.id, r]));

  // Group unplaced devices per (site, tier) to spread them on a ring at that tier's height.
  const groups = new Map<string, DeviceInput[]>();
  const rackSlots = new Map<string, number>();
  for (const d of input.devices) {
    const tier = d.tier ?? DEFAULT_TIER[d.role];
    if (d.x !== undefined && d.z !== undefined) continue;
    if (d.rackId && rackById.has(d.rackId)) continue;
    const key = `${d.siteId}|${tier}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const now = Date.now();
  const devices: Device[] = input.devices.map((d) => {
    const tier = d.tier ?? DEFAULT_TIER[d.role];
    let { x, y, z } = d;
    const rack = d.rackId ? rackById.get(d.rackId) : undefined;
    if ((x === undefined || z === undefined) && rack) {
      x = rack.x;
      z = rack.z;
      if (tier === 'endpoint') {
        const slot = rackSlots.get(rack.id) ?? 0;
        rackSlots.set(rack.id, slot + 1);
        y ??= 1.1 + slot * 1.55;
      }
    } else if (x === undefined || z === undefined) {
      const g = groups.get(`${d.siteId}|${tier}`) ?? [d];
      const i = g.indexOf(d);
      const r = Math.min(SITE_RADIUS * 0.7, 6 + g.length * 3);
      const a = (i / g.length) * Math.PI * 2 + Math.PI / 2;
      x = g.length === 1 ? 0 : Math.cos(a) * r;
      z = g.length === 1 ? 0 : Math.sin(a) * r;
    }
    const cpu = d.cpu ?? 0.2;
    return {
      ...d,
      tier,
      x: x!,
      y: y ?? TIER_Y[tier] + (tier === 'endpoint' ? 1.2 : 0),
      z: z!,
      scale: d.scale ?? (tier === 'core' ? 1.35 : 1),
      model: d.model ?? '',
      os: d.os ?? '',
      serial: d.serial ?? '',
      mac: d.mac ?? '',
      vlans: d.vlans ?? [],
      interfaces: [],
      cpu,
      mem: d.mem ?? 0.3,
      cpuHistory: d.cpuHistory ?? Array(60).fill(cpu),
      bootedAt: d.bootedAt ?? now,
      reachable: d.reachable ?? true,
      flapping: d.flapping ?? false,
    };
  });
  const byId = new Map(devices.map((d) => [d.id, d]));

  const links: Link[] = input.links
    .filter((l) => byId.has(l.a.deviceId) && byId.has(l.b.deviceId))
    .map((l) => {
      const a = byId.get(l.a.deviceId)!;
      const b = byId.get(l.b.deviceId)!;
      const link: Link = {
        ...l,
        kind: l.kind ?? (a.siteId !== b.siteId ? 'wan' : a.tier === 'endpoint' || b.tier === 'endpoint' ? 'access' : 'fabric'),
        util: l.util ?? 0,
        status: l.status ?? 'up',
        flapping: l.flapping ?? false,
        flaps: l.flaps ?? 0,
        errors: l.errors ?? 0,
      };
      a.interfaces.push({ name: l.a.iface, linkId: l.id });
      b.interfaces.push({ name: l.b.iface, linkId: l.id });
      return link;
    });

  return { sites, devices, links, alarms: input.alarms ?? [] };
}
