/** Fuzzy search index for the command palette: hostnames, IPs, MACs, VLANs, sites, racks, alarms. */
import type { Model } from '../data/model';
import type { Selection } from '../data/types';

export type ResultKind = 'site' | 'rack' | 'device' | 'link' | 'alarm' | 'vlan';

export interface SearchEntry {
  kind: ResultKind;
  id: string;
  label: string;
  sub: string;
  keys: string[];
  select?: Selection;
}

export interface SearchHit extends SearchEntry {
  score: number;
}

const VLAN_NAMES: Record<number, string> = { 10: 'management', 100: 'production', 200: 'storage', 300: 'wireless' };

export function buildIndex(model: Model): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const s of model.topo.sites) {
    entries.push({ kind: 'site', id: s.id, label: s.name, sub: `Site · ${s.region} · ${s.code.toUpperCase()}`, keys: [s.name, s.code, ...s.aliases], select: { kind: 'site', id: s.id } });
    for (const r of s.racks) {
      entries.push({ kind: 'rack', id: r.id, label: `${s.name} ${r.name}`, sub: `Rack · ${model.devicesInRack(r.id).length} devices`, keys: [r.name, `${s.code} ${r.name}`, `${s.name} ${r.name}`], select: { kind: 'rack', id: r.id } });
    }
  }
  for (const d of model.topo.devices) {
    entries.push({ kind: 'device', id: d.id, label: d.hostname, sub: `${d.ip} · ${d.model}`, keys: [d.hostname, d.ip, d.mac, d.serial], select: { kind: 'device', id: d.id } });
  }
  for (const l of model.topo.links) {
    if (l.kind !== 'wan') continue;
    const label = `${l.a.deviceId} ↔ ${l.b.deviceId}`;
    entries.push({ kind: 'link', id: l.id, label, sub: `WAN link · ${l.capacityGbps} Gb/s`, keys: [label, `${l.a.deviceId} ${l.b.deviceId}`], select: { kind: 'link', id: l.id } });
  }
  const vlans = new Set(model.topo.devices.flatMap((d) => d.vlans));
  for (const v of [...vlans].sort((a, b) => a - b)) {
    const n = model.topo.devices.filter((d) => d.vlans.includes(v)).length;
    entries.push({ kind: 'vlan', id: `vlan-${v}`, label: `VLAN ${v}`, sub: `${VLAN_NAMES[v] ?? 'vlan'} · ${n} devices`, keys: [`vlan ${v}`, `vlan${v}`, VLAN_NAMES[v] ?? ''] });
  }
  return entries;
}

export function alarmEntries(model: Model): SearchEntry[] {
  return model.sortedAlarms().map((a) => ({
    kind: 'alarm' as const,
    id: a.id,
    label: a.title,
    sub: `${a.severity.toUpperCase()} · ${model.sites.get(a.siteId)?.name ?? ''}`,
    keys: [a.title, a.severity, a.targetId],
    select: { kind: a.targetType, id: a.targetId },
  }));
}

/** Score a key against a query: exact > prefix > word-prefix > substring > subsequence. */
export function scoreKey(key: string, q: string): number {
  const k = key.toLowerCase();
  if (!q) return 0;
  if (k === q) return 100;
  if (k.startsWith(q)) return 85 - Math.min(20, k.length - q.length) * 0.5;
  if (k.split(/[\s\-_.:/]+/).some((w) => w.startsWith(q))) return 70;
  const idx = k.indexOf(q);
  if (idx >= 0) return 60 - Math.min(20, idx);
  // subsequence (e.g. "lnleaf3" → "lon-leaf-03")
  let qi = 0;
  let gaps = 0;
  for (let i = 0; i < k.length && qi < q.length; i++) {
    if (k[i] === q[qi]) qi++;
    else if (qi > 0) gaps++;
  }
  return qi === q.length ? Math.max(5, 35 - gaps) : 0;
}

export function search(entries: SearchEntry[], query: string, limit = 40): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const e of entries) {
    let best = 0;
    for (const key of e.keys) if (key) best = Math.max(best, scoreKey(key, q));
    if (best > 0) hits.push({ ...e, score: best + (e.kind === 'site' ? 5 : e.kind === 'alarm' ? 2 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
}
