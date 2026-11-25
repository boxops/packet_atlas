/**
 * Seeded demo network: six sites, each with a core / distribution / access / endpoint hierarchy,
 * joined by a WAN mesh, plus a handful of realistic, pre-seeded problems so the first view
 * already has something worth looking at.
 */
import { rng } from '../core/util';
import type { Alarm, Device, Link, LinkKind, Rack, Role, Site, Tier, Topology } from './types';

/** Heights of the vertical tier layers (world units). */
export const TIER_Y: Record<Tier, number> = { core: 34, distribution: 22, access: 11, endpoint: 0 };
export const SITE_RADIUS = 44;

interface SiteSeed {
  name: string;
  code: string;
  region: string;
  x: number;
  z: number;
  racks: number;
  aliases: string[];
}

const SITE_SEEDS: SiteSeed[] = [
  { name: 'London', code: 'lon', region: 'EMEA', x: -80, z: -110, racks: 4, aliases: ['ldn', 'uk', 'lhr'] },
  { name: 'New York', code: 'nyc', region: 'AMER', x: -280, z: -40, racks: 4, aliases: ['ny', 'newyork', 'jfk'] },
  { name: 'Frankfurt', code: 'fra', region: 'EMEA', x: 50, z: -40, racks: 4, aliases: ['fra', 'de', 'germany'] },
  { name: 'Singapore', code: 'sin', region: 'APAC', x: 210, z: 140, racks: 3, aliases: ['sg', 'sgp'] },
  { name: 'Tokyo', code: 'tyo', region: 'APAC', x: 280, z: -70, racks: 4, aliases: ['tok', 'jp', 'japan', 'hnd'] },
  { name: 'São Paulo', code: 'sao', region: 'AMER', x: -190, z: 150, racks: 3, aliases: ['sao paulo', 'sp', 'brazil', 'gru'] },
];

const MODELS: Record<string, { model: string; os: string }> = {
  core: { model: 'AX-9800 Core Router', os: 'AtlasOS 24.2R1' },
  fw: { model: 'SG-5200 NGFW', os: 'ShieldOS 11.1.3' },
  spine: { model: 'FX-7300 Spine 32×400G', os: 'AtlasOS 24.2R1' },
  leaf: { model: 'FX-3100 Leaf 48×25G', os: 'AtlasOS 24.2R1' },
  csw: { model: 'CX-2400 Campus 48×1G', os: 'AtlasOS 23.4R2' },
  ap: { model: 'WA-7 Wi-Fi 7 AP', os: 'AirOS 6.4' },
  srv: { model: 'R760 Compute Node', os: 'Linux 6.8 LTS' },
};

const IFACE_PREFIX: Record<Role, string> = {
  router: 'xe-0/0/',
  firewall: 'ethernet1/',
  switch: 'Eth1/',
  ap: 'eth',
  server: 'ens1f',
};

export function generateTopology(seed = 7, now = Date.now()): Topology {
  const r = rng(seed);
  const sites: Site[] = [];
  const devices: Device[] = [];
  const links: Link[] = [];
  const byId = new Map<string, Device>();

  const hex2 = () => Math.floor(r() * 256).toString(16).padStart(2, '0');

  function addDevice(d: Omit<Device, 'interfaces' | 'cpu' | 'mem' | 'cpuHistory' | 'bootedAt' | 'reachable' | 'flapping' | 'mac' | 'serial'>) {
    const cpu = 0.12 + r() * 0.35;
    const dev: Device = {
      ...d,
      mac: `02:a7:${hex2()}:${hex2()}:${hex2()}:${hex2()}`,
      serial: `PA${Math.floor(1e8 + r() * 9e8)}`,
      interfaces: [],
      cpu,
      mem: 0.3 + r() * 0.35,
      cpuHistory: Array.from({ length: 60 }, () => Math.max(0.02, cpu + (r() - 0.5) * 0.08)),
      bootedAt: now - (3 + r() * 220) * 86400_000,
      reachable: true,
      flapping: false,
    };
    devices.push(dev);
    byId.set(dev.id, dev);
    return dev;
  }

  // Access switches number downlinks from 1 and uplinks from 49, like real 48-port leaf switches.
  const counters = new Map<string, { down: number; up: number }>();
  function nextIface(dev: Device, peer: Device): string {
    const c = counters.get(dev.id) ?? { down: 0, up: 0 };
    counters.set(dev.id, c);
    if (dev.role === 'server' || dev.role === 'ap') return `${IFACE_PREFIX[dev.role]}${c.down++}`;
    if (dev.role === 'switch' && dev.tier === 'access' && peer.tier !== 'endpoint') return `${IFACE_PREFIX.switch}${49 + c.up++}`;
    return `${IFACE_PREFIX[dev.role]}${++c.down}`;
  }

  function connect(a: Device, b: Device, kind: LinkKind, capacityGbps: number, baseUtil?: number) {
    const id = `link-${links.length + 1}`;
    const ia = nextIface(a, b);
    const ib = nextIface(b, a);
    a.interfaces.push({ name: ia, linkId: id });
    b.interfaces.push({ name: ib, linkId: id });
    const link: Link = {
      id,
      a: { deviceId: a.id, iface: ia },
      b: { deviceId: b.id, iface: ib },
      kind,
      capacityGbps,
      util: baseUtil ?? 0.08 + r() * 0.5,
      status: 'up',
      flapping: false,
      flaps: 0,
      errors: Math.floor(r() * 4),
    };
    links.push(link);
    return link;
  }

  SITE_SEEDS.forEach((s, si) => {
    const index = si + 1;
    const siteId = `site-${s.code}`;
    const racks: Rack[] = [];
    const spacing = 14;
    for (let ri = 0; ri < s.racks; ri++) {
      racks.push({
        id: `${siteId}-rack-a${ri + 1}`,
        name: `Rack A${ri + 1}`,
        siteId,
        x: (ri - (s.racks - 1) / 2) * spacing,
        z: 14,
      });
    }
    sites.push({ id: siteId, name: s.name, code: s.code, region: s.region, index, x: s.x, z: s.z, racks, aliases: s.aliases });

    const mgmt = (n: number) => `172.16.${index}.${n}`;
    const base = { siteId, scale: 1, vlans: [10] as number[] };
    const nn = (n: number) => String(n).padStart(2, '0');

    const cores = [1, 2].map((n) =>
      addDevice({ ...base, id: `${s.code}-core-${nn(n)}`, hostname: `${s.code}-core-${nn(n)}`, role: 'router', tier: 'core', ...MODELS.core, ip: mgmt(n), x: n === 1 ? -9 : 9, y: TIER_Y.core, z: -4, scale: 1.35 }),
    );
    const fws = [1, 2].map((n) =>
      addDevice({ ...base, id: `${s.code}-fw-${nn(n)}`, hostname: `${s.code}-fw-${nn(n)}`, role: 'firewall', tier: 'distribution', ...MODELS.fw, ip: mgmt(10 + n), x: n === 1 ? -24 : 24, y: TIER_Y.distribution, z: -10 }),
    );
    const spines = [1, 2].map((n) =>
      addDevice({ ...base, id: `${s.code}-spine-${nn(n)}`, hostname: `${s.code}-spine-${nn(n)}`, role: 'switch', tier: 'distribution', ...MODELS.spine, ip: mgmt(20 + n), x: n === 1 ? -9 : 9, y: TIER_Y.distribution, z: 3, scale: 1.2 }),
    );

    connect(cores[0], cores[1], 'fabric', 400, 0.1 + r() * 0.2);
    for (const c of cores) for (const f of fws) connect(c, f, 'fabric', 100);
    for (const f of fws) for (const sp of spines) connect(f, sp, 'fabric', 100);

    racks.forEach((rack, ri) => {
      const leaf = addDevice({
        ...base,
        id: `${s.code}-leaf-${nn(ri + 1)}`,
        hostname: `${s.code}-leaf-${nn(ri + 1)}`,
        role: 'switch',
        tier: 'access',
        rackId: rack.id,
        ...MODELS.leaf,
        ip: mgmt(30 + ri + 1),
        vlans: [10, 100, 200],
        x: rack.x,
        y: TIER_Y.access,
        z: rack.z,
      });
      for (const sp of spines) connect(sp, leaf, 'fabric', 100);
      const servers = 5;
      for (let k = 0; k < servers; k++) {
        const srv = addDevice({
          ...base,
          id: `${s.code}-srv-a${ri + 1}-${nn(k + 1)}`,
          hostname: `${s.code}-srv-a${ri + 1}-${nn(k + 1)}`,
          role: 'server',
          tier: 'endpoint',
          rackId: rack.id,
          ...MODELS.srv,
          ip: `10.${index}.${ri + 1}.${10 + k * 10}`,
          vlans: [100, k % 2 === 0 ? 200 : 100].filter((v, i, a) => a.indexOf(v) === i),
          x: rack.x,
          y: 1.1 + k * 1.55,
          z: rack.z,
        });
        connect(leaf, srv, 'access', 25, 0.05 + r() * 0.55);
      }
    });

    const csw = addDevice({ ...base, id: `${s.code}-csw-01`, hostname: `${s.code}-csw-01`, role: 'switch', tier: 'access', ...MODELS.csw, ip: mgmt(50), vlans: [10, 300], x: 0, y: TIER_Y.access, z: -22 });
    for (const sp of spines) connect(sp, csw, 'fabric', 10);
    [-14, 0, 14].forEach((x, k) => {
      const ap = addDevice({ ...base, id: `${s.code}-ap-${nn(k + 1)}`, hostname: `${s.code}-ap-${nn(k + 1)}`, role: 'ap', tier: 'endpoint', ...MODELS.ap, ip: `10.${index}.30.${k + 2}`, vlans: [300], x, y: 1.2, z: k === 1 ? -32 : -29 });
      connect(csw, ap, 'access', 1, 0.1 + r() * 0.5);
    });
  });

  // ── WAN mesh between core routers ──
  const core = (code: string, n: number) => byId.get(`${code}-core-0${n}`)!;
  const wan: [string, number, string, number, number][] = [
    ['lon', 1, 'nyc', 1, 100],
    ['lon', 2, 'fra', 1, 100],
    ['fra', 2, 'sin', 1, 100],
    ['sin', 2, 'tyo', 1, 100],
    ['tyo', 2, 'nyc', 2, 100],
    ['nyc', 2, 'sao', 1, 10],
    ['sao', 2, 'lon', 1, 10],
    ['lon', 2, 'sin', 1, 40],
    ['fra', 1, 'nyc', 1, 40],
  ];
  for (const [a, an, b, bn, cap] of wan) connect(core(a, an), core(b, bn), 'wan', cap, 0.2 + r() * 0.4);

  const topo: Topology = { sites, devices, links, alarms: [] };
  seedProblems(topo, now);
  return topo;
}

export function findLink(t: Topology, a: string, b: string): Link | undefined {
  return t.links.find((l) => (l.a.deviceId === a && l.b.deviceId === b) || (l.a.deviceId === b && l.b.deviceId === a));
}

/** The pre-seeded incidents that make the demo meaningful on first open. */
function seedProblems(t: Topology, now: number) {
  const dev = (id: string) => t.devices.find((d) => d.id === id)!;
  const min = 60_000;
  const add = (a: Omit<Alarm, 'id'>) => t.alarms.push({ ...a, id: `alarm-${t.alarms.length + 1}` });

  // 1. London: spine-02 ↔ leaf-03 uplink hard down.
  const lonDown = findLink(t, 'lon-spine-02', 'lon-leaf-03')!;
  lonDown.status = 'down';
  lonDown.util = 0;
  lonDown.errors = 1843;
  dev('lon-leaf-03').cpu = 0.81;
  add({
    severity: 'critical',
    targetType: 'link',
    targetId: lonDown.id,
    siteId: 'site-lon',
    title: `Link down: lon-spine-02 ${lonDown.a.iface} ↔ lon-leaf-03 ${lonDown.b.iface}`,
    explanation:
      'Rack A3 has lost one of its two fabric uplinks. Traffic is failing over to lon-spine-01, so the rack is up but has no redundancy and half its uplink capacity.',
    action: 'Check optics/cabling on lon-leaf-03 Eth1/50 (CRC errors rose before it failed), then run "show interfaces Eth1/50 transceiver".',
    raisedAt: now - 7 * min,
  });

  // 2. Singapore: a compute node stopped answering.
  const ghost = dev('sin-srv-a2-03');
  ghost.reachable = false;
  ghost.cpu = 0;
  add({
    severity: 'critical',
    targetType: 'device',
    targetId: ghost.id,
    siteId: 'site-sin',
    title: 'Device unreachable: sin-srv-a2-03',
    explanation:
      'No ICMP or SNMP response for 4 minutes. Its leaf port is still up, which points to a host-level failure (kernel hang or power supply) rather than the network.',
    action: 'Open the out-of-band console (iDRAC) for sin-srv-a2-03 and check power state.',
    raisedAt: now - 4 * min,
  });

  // 3. Frankfurt firewall session table nearly full.
  const fw = dev('fra-fw-01');
  fw.cpu = 0.88;
  add({
    severity: 'major',
    targetType: 'device',
    targetId: fw.id,
    siteId: 'site-fra',
    title: 'Session table at 91% on fra-fw-01',
    explanation:
      'Concurrent sessions have climbed steadily over 40 minutes. At 100% new connections through Frankfurt will be dropped. This often means a scan or a misbehaving client.',
    action: 'Run "show session top-sources" and compare with fra-fw-02; consider failing over if it crosses 95%.',
    raisedAt: now - 18 * min,
  });

  // 4. Tokyo AP uplink flapping.
  const ap = dev('tyo-ap-02');
  ap.flapping = true;
  const apLink = findLink(t, 'tyo-csw-01', 'tyo-ap-02')!;
  apLink.flapping = true;
  apLink.flaps = 7;
  add({
    severity: 'warning',
    targetType: 'link',
    targetId: apLink.id,
    siteId: 'site-tyo',
    title: 'Interface flapping: tyo-csw-01 ↔ tyo-ap-02',
    explanation: 'The port has flapped 7 times in 10 minutes. Wireless clients on tyo-ap-02 will see brief drop-outs each time.',
    action: 'Check PoE budget on tyo-csw-01 and reseat the patch lead; disable the port to force clients to roam if it keeps flapping.',
    raisedAt: now - 11 * min,
  });

  // 5. Transatlantic WAN congestion.
  const hot = findLink(t, 'lon-core-01', 'nyc-core-01')!;
  hot.util = 0.93;
  add({
    severity: 'warning',
    targetType: 'link',
    targetId: hot.id,
    siteId: 'site-nyc',
    title: 'WAN congestion: lon-core-01 ↔ nyc-core-01 at 93%',
    explanation: 'The London to New York circuit is running above 90% and latency-sensitive traffic is starting to queue. The Frankfurt to New York path has spare capacity.',
    action: 'Shift some prefixes to the fra-core-01 ↔ nyc-core-01 path (raise local-pref), or ask the carrier about burst capacity.',
    raisedAt: now - 23 * min,
  });

  // 6. São Paulo BGP instability.
  add({
    severity: 'major',
    targetType: 'device',
    targetId: 'sao-core-02',
    siteId: 'site-sao',
    title: 'BGP session to lon-core-01 reset 3× in 15 min',
    explanation: 'The eBGP session over the São Paulo to London circuit keeps resetting, so routes are withdrawn and re-learned each time and traffic briefly shifts to New York.',
    action: 'Check hold-timer expiries and circuit errors: "show bgp neighbor 172.16.1.1" and the carrier ticket.',
    raisedAt: now - 15 * min,
  });
}
