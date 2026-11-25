/** Core domain model for Packet Atlas. A real data source only has to produce a `Topology`. */

export type Role = 'router' | 'firewall' | 'switch' | 'ap' | 'server';
/** Vertical network tier: WAN/core at the top, endpoints at ground level. */
export type Tier = 'core' | 'distribution' | 'access' | 'endpoint';
export type Health = 'ok' | 'warning' | 'critical' | 'unreachable';
export type Severity = 'critical' | 'major' | 'warning';
export type LinkKind = 'wan' | 'fabric' | 'access';

export interface Site {
  id: string;
  name: string;
  /** Short code, used as hostname prefix (e.g. "lon"). */
  code: string;
  region: string;
  /** Index used for addressing (10.<index>.x.x) and the 1–9 shortcuts. */
  index: number;
  /** World-space centre of the site island (x, z). */
  x: number;
  z: number;
  racks: Rack[];
  aliases: string[];
}

export interface Rack {
  id: string;
  name: string;
  siteId: string;
  /** Position relative to the site centre. */
  x: number;
  z: number;
}

export interface Interface {
  name: string;
  linkId: string;
}

export interface Device {
  id: string;
  hostname: string;
  role: Role;
  tier: Tier;
  siteId: string;
  rackId?: string;
  model: string;
  os: string;
  serial: string;
  ip: string;
  mac: string;
  vlans: number[];
  /** Position relative to the site centre (y is absolute height). */
  x: number;
  y: number;
  z: number;
  /** Larger visual for core devices. */
  scale: number;
  interfaces: Interface[];
  // ── live telemetry ──
  cpu: number; // 0..1
  mem: number; // 0..1
  cpuHistory: number[];
  bootedAt: number; // epoch ms
  reachable: boolean;
  flapping: boolean;
}

export interface LinkEnd {
  deviceId: string;
  iface: string;
}

export interface Link {
  id: string;
  a: LinkEnd;
  b: LinkEnd;
  kind: LinkKind;
  capacityGbps: number;
  // ── live telemetry ──
  util: number; // 0..1
  status: 'up' | 'down';
  flapping: boolean;
  flaps: number;
  errors: number;
}

export interface Alarm {
  id: string;
  severity: Severity;
  targetType: 'device' | 'link';
  targetId: string;
  siteId: string;
  title: string;
  /** One-paragraph plain-language explanation shown in incident mode. */
  explanation: string;
  /** Suggested next step. */
  action: string;
  raisedAt: number;
}

export interface Topology {
  sites: Site[];
  devices: Device[];
  links: Link[];
  alarms: Alarm[];
}

/** Navigation levels: Global > Site > Rack > Device. */
export type ViewTarget =
  | { level: 'global' }
  | { level: 'site'; siteId: string }
  | { level: 'rack'; siteId: string; rackId: string }
  | { level: 'device'; deviceId: string }
  | { level: 'link'; linkId: string };

/** Anything that can be selected / inspected. */
export type Selection =
  | { kind: 'site'; id: string }
  | { kind: 'rack'; id: string }
  | { kind: 'device'; id: string }
  | { kind: 'link'; id: string };
