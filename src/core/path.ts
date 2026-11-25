/** Path tracing between two endpoints over the live topology (skips down links and dead devices). */
import type { Model } from '../data/model';
import type { Device, Link } from '../data/types';

export interface Hop {
  device: Device;
  /** Link used to reach this hop (undefined for the source). */
  via?: Link;
  inIface?: string;
  outIface?: string;
}

export interface PathResult {
  ok: boolean;
  error?: string;
  from?: Device;
  to?: Device;
  hops: Hop[];
  linkIds: string[];
  /** For each link on the path, true if it is traversed b → a (used to direct particle flow). */
  reversed: Record<string, boolean>;
  /** Mock one-way latency in ms (fabric hops ~0.05 ms, WAN by distance). */
  latencyMs: number;
}

export function tracePath(model: Model, fromQ: string, toQ: string): PathResult {
  const from = model.findDevice(fromQ);
  const to = model.findDevice(toQ);
  const empty: PathResult = { ok: false, hops: [], linkIds: [], reversed: {}, latencyMs: 0, from, to };
  if (!from) return { ...empty, error: `Unknown endpoint "${fromQ}"` };
  if (!to) return { ...empty, error: `Unknown endpoint "${toQ}"` };
  if (!from.reachable) return { ...empty, error: `${from.hostname} is unreachable` };
  if (!to.reachable) return { ...empty, error: `${to.hostname} is unreachable` };

  const prev = new Map<string, { dev: string; link: Link }>();
  const seen = new Set([from.id]);
  const queue = [from.id];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to.id) break;
    for (const link of model.linksOf(cur)) {
      if (link.status === 'down') continue;
      const nb = model.peer(link, cur).deviceId;
      if (seen.has(nb) || !model.devices.get(nb)!.reachable) continue;
      seen.add(nb);
      prev.set(nb, { dev: cur, link });
      queue.push(nb);
    }
  }
  if (!seen.has(to.id)) return { ...empty, error: `No live path between ${from.hostname} and ${to.hostname}` };

  const chain: { id: string; link?: Link }[] = [];
  for (let cur: string | undefined = to.id; cur; ) {
    const p = prev.get(cur);
    chain.unshift({ id: cur, link: p?.link });
    cur = p?.dev;
  }

  const hops: Hop[] = [];
  const reversed: Record<string, boolean> = {};
  let latencyMs = 0;
  chain.forEach((c, i) => {
    const device = model.devices.get(c.id)!;
    const hop: Hop = { device, via: c.link };
    if (c.link) {
      const prevId = chain[i - 1].id;
      reversed[c.link.id] = c.link.a.deviceId !== prevId;
      hop.inIface = c.link.a.deviceId === c.id ? c.link.a.iface : c.link.b.iface;
      hops[i - 1].outIface = c.link.a.deviceId === prevId ? c.link.a.iface : c.link.b.iface;
      if (c.link.kind === 'wan') {
        const sa = model.sites.get(model.devices.get(prevId)!.siteId)!;
        const sb = model.sites.get(device.siteId)!;
        latencyMs += Math.hypot(sa.x - sb.x, sa.z - sb.z) * 0.12;
      } else latencyMs += 0.04 + c.link.util * 0.05;
    }
    hops.push(hop);
  });

  return { ok: true, from, to, hops, linkIds: chain.filter((c) => c.link).map((c) => c.link!.id), reversed, latencyMs };
}
