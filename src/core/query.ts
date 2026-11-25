/**
 * Natural-language query parsing for the command palette, e.g.
 *   "show me all down links in London"
 *   "path from 10.1.1.10 to 10.2.2.20"
 *   "critical alarms", "firewalls in frankfurt", "links over 80%", "vlan 200 in tokyo"
 * Deliberately rule-based: it is predictable, instant, and works offline.
 */
import type { Model } from '../data/model';
import type { LinkKind, Role, Tier } from '../data/types';

export type StateFilter = 'down' | 'up' | 'critical' | 'warning' | 'major' | 'unreachable' | 'flapping' | 'healthy';

export interface FilterQuery {
  kind: 'filter';
  entity: 'links' | 'devices' | 'alarms' | 'any';
  states: StateFilter[];
  roles: Role[];
  tiers: Tier[];
  linkKinds: LinkKind[];
  siteIds: string[];
  minUtil?: number;
  vlan?: number;
}

export interface PathQuery {
  kind: 'path';
  from: string;
  to: string;
}

export type Query = FilterQuery | PathQuery;

export interface FilterResult {
  devices: string[];
  links: string[];
  alarms: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

const has = (text: string, re: RegExp) => re.test(text);

export function parseQuery(input: string, model: Model): Query | null {
  const text = norm(input).trim().replace(/\s+/g, ' ');
  if (!text) return null;

  // ── path trace ──
  const pathRe = /\b(?:path|trace(?:route)?|route)\b(?:\s+from)?\s+(\S+)\s+(?:to|->|→)\s+(\S+)/;
  const arrowRe = /^(?:from\s+)?(\S+)\s*(?:->|→|=>)\s*(\S+)$/;
  const fromToRe = /^from\s+(\S+)\s+to\s+(\S+)$/;
  const m = text.match(pathRe) ?? text.match(arrowRe) ?? text.match(fromToRe);
  if (m) return { kind: 'path', from: m[1], to: m[2] };

  // A single identifier-like token (hostname, IP, MAC) is a lookup, not a question.
  if (!text.includes(' ') && (model.findDevice(text) || /[-.:\d]/.test(text))) return null;

  // ── filters ──
  const q: FilterQuery = { kind: 'filter', entity: 'any', states: [], roles: [], tiers: [], linkKinds: [], siteIds: [] };
  let signal = false;

  if (has(text, /\b(links?|interfaces?|ports?|circuits?|uplinks?|connections?)\b/)) q.entity = 'links';
  if (has(text, /\bwan\b/)) {
    q.entity = 'links';
    q.linkKinds.push('wan');
  }
  if (has(text, /\b(alarms?|alerts?|incidents?|problems?|issues?|events?)\b/)) q.entity = 'alarms';
  if (has(text, /\b(devices?|nodes?|boxes|equipment|kit)\b/)) q.entity = 'devices';

  const roleWords: [RegExp, Role, Tier?][] = [
    [/\b(routers?|rtrs?)\b/, 'router'],
    [/\b(firewalls?|fws?)\b/, 'firewall'],
    [/\b(switch(es)?)\b/, 'switch'],
    [/\b(spines?)\b/, 'switch', 'distribution'],
    [/\b(leaf|leaves|leafs|tors?)\b/, 'switch', 'access'],
    [/\b(aps?|access ?points?|wi-?fi|wireless)\b/, 'ap'],
    [/\b(servers?|hosts?|compute|srvs?)\b/, 'server'],
  ];
  for (const [re, role, tier] of roleWords) {
    if (has(text, re)) {
      if (!q.roles.includes(role)) q.roles.push(role);
      if (tier) q.tiers.push(tier);
      if (q.entity === 'any') q.entity = 'devices';
    }
  }
  if (has(text, /\bcore\b/)) q.tiers.push('core');
  if (has(text, /\bdistribution\b/)) q.tiers.push('distribution');
  if (has(text, /\baccess\b/) && !has(text, /access ?points?/)) q.tiers.push('access');

  const stateWords: [RegExp, StateFilter][] = [
    [/\b(down|dead|failed|broken|lost)\b/, 'down'],
    [/\bup\b/, 'up'],
    [/\b(critical|crit|red|sev ?1|p1)\b/, 'critical'],
    [/\b(major)\b/, 'major'],
    [/\b(warnings?|warn|amber|minor)\b/, 'warning'],
    [/\b(unreachable|offline|ghosts?|unresponsive|missing)\b/, 'unreachable'],
    [/\b(flapping|flaps?|flappy|unstable|bouncing)\b/, 'flapping'],
    [/\b(healthy|ok|green|fine)\b/, 'healthy'],
  ];
  for (const [re, st] of stateWords) if (has(text, re)) q.states.push(st);

  const over = text.match(/(?:over|above|>|more than|exceeding|at least)\s*(\d{1,3})\s*%/) ?? text.match(/(\d{1,3})\s*%\s*(?:\+|or more)/);
  if (over) q.minUtil = Math.min(100, +over[1]) / 100;
  else if (has(text, /\b(congested|busy|hot|saturated|high util(isation|ization)?|heavily used|maxed)\b/)) q.minUtil = 0.8;
  if (q.minUtil !== undefined && q.entity === 'any') q.entity = 'links';

  const vlan = text.match(/\bvlan\s*(\d{1,4})\b/);
  if (vlan) {
    q.vlan = +vlan[1];
    if (q.entity === 'any') q.entity = 'devices';
  }

  for (const s of model.topo.sites) {
    const names = [norm(s.name), s.code, ...s.aliases.map(norm)];
    if (names.some((n) => new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text))) q.siteIds.push(s.id);
  }

  signal = q.entity !== 'any' || q.states.length > 0 || q.roles.length > 0 || q.tiers.length > 0 || q.minUtil !== undefined || q.vlan !== undefined;
  return signal ? q : null;
}

export function runFilter(q: FilterQuery, model: Model): FilterResult {
  const res: FilterResult = { devices: [], links: [], alarms: [] };
  const inSites = (ids: string[]) => q.siteIds.length === 0 || ids.some((id) => q.siteIds.includes(id));
  const st = new Set(q.states);

  const wantLinks = q.entity === 'links' || (q.entity === 'any' && (st.has('down') || st.has('flapping')));
  const wantDevices = q.entity === 'devices' || q.entity === 'any';
  const wantAlarms = q.entity === 'alarms';

  if (wantLinks) {
    for (const l of model.topo.links) {
      if (!inSites(model.linkSites(l))) continue;
      if (q.linkKinds.length && !q.linkKinds.includes(l.kind)) continue;
      if (q.roles.length) {
        const roles = [l.a, l.b].map((e) => model.devices.get(e.deviceId)!.role);
        if (!roles.some((r) => q.roles.includes(r))) continue;
      }
      if (st.has('down') && l.status !== 'down') continue;
      if (st.has('up') && l.status !== 'up') continue;
      if (st.has('flapping') && !l.flapping) continue;
      const h = model.linkHealth(l.id);
      if (st.has('critical') && h !== 'critical') continue;
      if (st.has('warning') && h !== 'warning') continue;
      if (st.has('healthy') && h !== 'ok') continue;
      if (q.minUtil !== undefined && l.util < q.minUtil) continue;
      res.links.push(l.id);
    }
  }

  if (wantDevices) {
    for (const d of model.topo.devices) {
      if (!inSites([d.siteId])) continue;
      if (q.roles.length && !q.roles.includes(d.role)) continue;
      if (q.tiers.length && !q.tiers.includes(d.tier)) continue;
      if (q.vlan !== undefined && !d.vlans.includes(q.vlan)) continue;
      const h = model.deviceHealth(d.id);
      if ((st.has('down') || st.has('unreachable')) && d.reachable) continue;
      if (st.has('flapping') && !d.flapping) continue;
      if (st.has('critical') && h !== 'critical') continue;
      if ((st.has('warning') || st.has('major')) && h !== 'warning') continue;
      if (st.has('healthy') && h !== 'ok') continue;
      if (q.minUtil !== undefined && q.entity === 'devices' && d.cpu < q.minUtil) continue;
      res.devices.push(d.id);
    }
  }

  if (wantAlarms) {
    for (const a of model.sortedAlarms()) {
      if (!inSites([a.siteId])) continue;
      const sev = [st.has('critical') && 'critical', st.has('major') && 'major', st.has('warning') && 'warning'].filter(Boolean);
      if (sev.length && !sev.includes(a.severity)) continue;
      if (q.roles.length) {
        const dev = a.targetType === 'device' ? model.devices.get(a.targetId) : undefined;
        const link = a.targetType === 'link' ? model.links.get(a.targetId) : undefined;
        const roles = dev ? [dev.role] : link ? [link.a, link.b].map((e) => model.devices.get(e.deviceId)!.role) : [];
        if (!roles.some((r) => q.roles.includes(r))) continue;
      }
      res.alarms.push(a.id);
      if (a.targetType === 'device') res.devices.push(a.targetId);
      else res.links.push(a.targetId);
    }
  }
  return res;
}

/** Human-readable summary of a filter, e.g. "1 down link in London". */
export function describeFilter(q: FilterQuery, r: FilterResult, model: Model): string {
  const sites = q.siteIds.map((id) => model.sites.get(id)!.name);
  const where = sites.length ? ` in ${sites.join(' & ')}` : '';
  const states = q.states.join(' ');
  if (q.entity === 'alarms') return `${r.alarms.length} ${states ? states + ' ' : ''}alarm${r.alarms.length === 1 ? '' : 's'}${where}`;
  const parts: string[] = [];
  if (r.links.length || q.entity === 'links') parts.push(`${r.links.length} ${states ? states + ' ' : ''}${q.linkKinds.includes('wan') ? 'WAN ' : ''}link${r.links.length === 1 ? '' : 's'}${q.minUtil !== undefined ? ` ≥ ${Math.round(q.minUtil * 100)}%` : ''}`);
  if (r.devices.length || q.entity === 'devices') {
    const noun = q.roles.length === 1 ? { router: 'router', firewall: 'firewall', switch: 'switch', ap: 'access point', server: 'server' }[q.roles[0]] : 'device';
    const plural = r.devices.length === 1 ? noun : noun === 'switch' ? 'switches' : `${noun}s`;
    parts.push(`${r.devices.length} ${states ? states + ' ' : ''}${q.vlan !== undefined ? `VLAN ${q.vlan} ` : ''}${plural}`);
  }
  return parts.join(' + ') + where;
}
