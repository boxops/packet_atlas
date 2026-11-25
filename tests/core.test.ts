import { describe, expect, it } from 'vitest';
import { generateTopology } from '../src/data/mock';
import { Model } from '../src/data/model';
import { parseQuery, runFilter, describeFilter, type FilterQuery } from '../src/core/query';
import { tracePath } from '../src/core/path';
import { buildIndex, search } from '../src/core/search';

const model = new Model();
model.load(generateTopology(7, 1_700_000_000_000));

describe('mock topology', () => {
  it('is deterministic and well-formed', () => {
    const again = generateTopology(7, 1_700_000_000_000);
    expect(again.devices.map((d) => d.mac)).toEqual(model.topo.devices.map((d) => d.mac));
    for (const l of model.topo.links) {
      expect(model.devices.has(l.a.deviceId)).toBe(true);
      expect(model.devices.has(l.b.deviceId)).toBe(true);
    }
    expect(new Set(model.topo.devices.map((d) => d.ip)).size).toBe(model.topo.devices.length);
  });

  it('contains the example endpoints from the spec', () => {
    expect(model.findDevice('10.1.1.10')?.hostname).toBe('lon-srv-a1-01');
    expect(model.findDevice('10.2.2.20')?.hostname).toBe('nyc-srv-a2-02');
  });

  it('numbers leaf uplinks from Eth1/49', () => {
    const leaf = model.devices.get('lon-leaf-03')!;
    expect(leaf.interfaces.slice(0, 2).map((i) => i.name)).toEqual(['Eth1/49', 'Eth1/50']);
    expect(leaf.interfaces[2].name).toBe('Eth1/1');
  });

  it('derives health from alarms and reachability', () => {
    expect(model.deviceHealth('sin-srv-a2-03')).toBe('unreachable');
    expect(model.deviceHealth('fra-fw-01')).toBe('warning');
    expect(model.siteHealth('site-lon')).toBe('critical');
    expect(model.siteHealth('site-fra')).toBe('warning');
  });

  it('builds breadcrumbs Global > London > Rack A3 > lon-leaf-03', () => {
    const crumbs = model.breadcrumbs({ level: 'device', deviceId: 'lon-leaf-03' }).map((c) => c.label);
    expect(crumbs).toEqual(['Global', 'London', 'Rack A3', 'lon-leaf-03']);
    expect(model.parentView({ level: 'site', siteId: 'site-lon' })).toEqual({ level: 'global' });
  });

  it('orders alarms by severity', () => {
    const sev = model.sortedAlarms().map((a) => a.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ['critical', 'major', 'warning'].indexOf(a) - ['critical', 'major', 'warning'].indexOf(b)));
  });
});

describe('natural-language queries', () => {
  it('parses "show me all down links in London"', () => {
    const q = parseQuery('show me all down links in London', model) as FilterQuery;
    expect(q.kind).toBe('filter');
    expect(q.entity).toBe('links');
    expect(q.states).toContain('down');
    expect(q.siteIds).toEqual(['site-lon']);
    const r = runFilter(q, model);
    expect(r.links).toHaveLength(1);
    expect(describeFilter(q, r, model)).toBe('1 down link in London');
  });

  it('parses path queries in several phrasings', () => {
    for (const s of ['path from 10.1.1.10 to 10.2.2.20', 'trace 10.1.1.10 to 10.2.2.20', '10.1.1.10 -> 10.2.2.20', 'from 10.1.1.10 to 10.2.2.20']) {
      expect(parseQuery(s, model)).toEqual({ kind: 'path', from: '10.1.1.10', to: '10.2.2.20' });
    }
  });

  it('handles roles, sites with accents, thresholds and vlans', () => {
    const fw = parseQuery('firewalls in frankfurt', model) as FilterQuery;
    expect(runFilter(fw, model).devices).toEqual(['fra-fw-01', 'fra-fw-02']);
    const sp = parseQuery('devices in sao paulo', model) as FilterQuery;
    expect(sp.siteIds).toEqual(['site-sao']);
    const hot = parseQuery('links over 90%', model) as FilterQuery;
    expect(hot.minUtil).toBe(0.9);
    expect(runFilter(hot, model).links.length).toBeGreaterThanOrEqual(1);
    const v = parseQuery('vlan 300 in tokyo', model) as FilterQuery;
    expect(runFilter(v, model).devices).toEqual(['tyo-csw-01', 'tyo-ap-01', 'tyo-ap-02', 'tyo-ap-03']);
    const crit = parseQuery('critical alarms', model) as FilterQuery;
    expect(runFilter(crit, model).alarms).toHaveLength(2);
    expect(parseQuery('unreachable servers', model)).toMatchObject({ entity: 'devices', roles: ['server'] });
  });

  it('returns null for plain search terms so fuzzy search takes over', () => {
    expect(parseQuery('lon-leaf-03', model)).toBeNull();
    expect(parseQuery('London', model)).toBeNull();
    expect(parseQuery('10.1.1.10', model)).toBeNull();
  });
});

describe('path trace', () => {
  it('finds a cross-site path and avoids the down link', () => {
    const p = tracePath(model, '10.1.1.10', '10.2.2.20');
    expect(p.ok).toBe(true);
    expect(p.hops[0].device.hostname).toBe('lon-srv-a1-01');
    expect(p.hops.at(-1)!.device.hostname).toBe('nyc-srv-a2-02');
    const down = model.topo.links.find((l) => l.status === 'down')!;
    expect(p.linkIds).not.toContain(down.id);
    expect(p.latencyMs).toBeGreaterThan(1);
  });

  it('reports unknown and unreachable endpoints', () => {
    expect(tracePath(model, '1.2.3.4', '10.1.1.10').error).toMatch(/Unknown/);
    expect(tracePath(model, 'sin-srv-a2-03', '10.1.1.10').error).toMatch(/unreachable/);
  });
});

describe('fuzzy search', () => {
  const idx = buildIndex(model);
  it('finds by hostname, IP, MAC, VLAN and subsequence', () => {
    expect(search(idx, 'lon-leaf-03')[0].id).toBe('lon-leaf-03');
    expect(search(idx, '10.2.2.20')[0].id).toBe('nyc-srv-a2-02');
    const mac = model.devices.get('tyo-core-01')!.mac;
    expect(search(idx, mac)[0].id).toBe('tyo-core-01');
    expect(search(idx, 'vlan 200')[0].kind).toBe('vlan');
    expect(search(idx, 'lonleaf03')[0].id).toBe('lon-leaf-03');
    expect(search(idx, 'tokyo')[0].id).toBe('site-tyo');
  });
});

describe('topology import', () => {
  it('auto-lays-out a minimal topology from a real source', async () => {
    const { normalizeTopology } = await import('../src/data/normalize');
    const t = normalizeTopology({
      sites: [{ id: 's1', name: 'Dublin', racks: [{ id: 'r1', name: 'Rack 1' }] }, { id: 's2', name: 'Paris' }],
      devices: [
        { id: 'r-a', hostname: 'dub-rtr', role: 'router', siteId: 's1', ip: '10.0.0.1' },
        { id: 'sw', hostname: 'dub-sw', role: 'switch', siteId: 's1', rackId: 'r1', ip: '10.0.0.2' },
        { id: 'srv', hostname: 'dub-srv', role: 'server', siteId: 's1', rackId: 'r1', ip: '10.0.0.3' },
        { id: 'r-b', hostname: 'par-rtr', role: 'router', siteId: 's2', ip: '10.1.0.1' },
      ],
      links: [
        { id: 'l1', a: { deviceId: 'r-a', iface: 'ge-0/0/0' }, b: { deviceId: 'sw', iface: 'Eth1/49' }, capacityGbps: 10 },
        { id: 'l2', a: { deviceId: 'r-a', iface: 'ge-0/0/1' }, b: { deviceId: 'r-b', iface: 'ge-0/0/1' }, capacityGbps: 10 },
        { id: 'bad', a: { deviceId: 'nope', iface: 'x' }, b: { deviceId: 'sw', iface: 'y' }, capacityGbps: 1 },
      ],
    });
    expect(t.links.map((l) => l.kind)).toEqual(['fabric', 'wan']);
    expect(t.sites[0].x).not.toBe(t.sites[1].x);
    const m = new Model();
    m.load(t);
    expect(m.devices.get('r-a')!.y).toBe(34);
    expect(m.devices.get('srv')!.tier).toBe('endpoint');
    expect(m.neighbours('r-a')).toHaveLength(2);
    expect(tracePath(m, 'dub-sw', 'par-rtr').hops).toHaveLength(3);
  });
});
