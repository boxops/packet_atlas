/**
 * Context-aware inspector content. Most important first (status, alarms, key numbers, top
 * interfaces), then progressive disclosure via <details>. Values that change with telemetry
 * are marked data-live / data-bar / data-spark so they can update in place without re-rendering.
 */
import type { Model } from '../data/model';
import type { Device, Health, Link, Selection } from '../data/types';
import { palette } from '../core/palette';
import { esc, formatBps, formatDuration, pct, timeAgo } from '../core/util';
import { icon, sparkline } from './dom';

export type Live = Record<string, string | number>;

const ROLE_NAME: Record<Device['role'], string> = { router: 'Router', firewall: 'Firewall', switch: 'Switch', ap: 'Access point', server: 'Server' };

export function healthPill(h: Health, label?: string): string {
  const p = palette();
  const text = label ?? { ok: 'Healthy', warning: 'Warning', critical: 'Critical', unreachable: 'Unreachable' }[h];
  return `<span class="pill h-${h}"><span class="glyph">${p.glyph[h]}</span>${esc(text)}</span>`;
}

function bar(key: string, value: number, cls = ''): string {
  return `<span class="bar ${cls}"><span data-bar="${key}" style="width:${Math.round(value * 100)}%"></span></span>`;
}

function alarmsBlock(model: Model, targetIds: string[]): string {
  const alarms = model.sortedAlarms().filter((a) => targetIds.includes(a.targetId));
  if (!alarms.length) return '';
  return `<section class="sec alarms">${alarms
    .map(
      (a) => `<div class="alarm sev-${a.severity}" data-alarm="${a.id}">
        <div class="alarm-title"><span class="sev">${a.severity}</span>${esc(a.title)}</div>
        <div class="alarm-expl">${esc(a.explanation)}</div>
        <div class="alarm-action"><b>Next step</b> ${esc(a.action)}</div>
        <div class="alarm-meta">Raised <span data-live="ago-${a.id}">${timeAgo(a.raisedAt)}</span></div>
      </div>`,
    )
    .join('')}</section>`;
}

function linkUtilClass(l: Link) {
  return l.status === 'down' ? 'down' : l.flapping || l.util >= 0.9 ? 'warn' : '';
}

function ifaceRow(n: ReturnType<Model['neighbours']>[number]): string {
  const l = n.link;
  const state = l.status === 'down' ? '<span class="st down">DOWN</span>' : l.flapping ? '<span class="st warn">FLAP</span>' : '<span class="st up">UP</span>';
  return `<div class="if-row" data-goto-link="${l.id}">
    <span class="mono if-name">${esc(n.localIface)}</span>
    <span class="if-peer" data-goto-device="${n.device.id}">→ ${esc(n.device.hostname)}</span>
    ${state}
    ${bar(`u-${l.id}`, l.util, linkUtilClass(l))}
    <span class="mono if-util" data-live="u-${l.id}">${l.status === 'down' ? '—' : pct(l.util)}</span>
  </div>`;
}

// ── device ──

export function renderDevice(model: Model, d: Device): string {
  const h = model.deviceHealth(d.id);
  const site = model.sites.get(d.siteId)!;
  const rack = d.rackId ? model.racks.get(d.rackId) : undefined;
  const nbs = model.neighbours(d.id);
  const top = [...nbs].sort((a, b) => (a.link.status === 'down' ? -1 : 0) - (b.link.status === 'down' ? -1 : 0) || +b.link.flapping - +a.link.flapping || b.link.util - a.link.util).slice(0, 3);
  const linkAlarmIds = nbs.map((n) => n.link.id);
  return `
  <header class="ph">
    <div class="ph-icon h-${h}">${icon(d.role, 22)}</div>
    <div class="ph-main">
      <div class="ph-title mono">${esc(d.hostname)}</div>
      <div class="ph-sub">${ROLE_NAME[d.role]} · ${esc(site.name)}${rack ? ` · ${esc(rack.name)}` : ''}</div>
    </div>
    ${healthPill(h)}
  </header>
  <div class="kv-strip">
    <button class="chip-btn mono" data-copy="${esc(d.ip)}" data-tip="Copy IP">${esc(d.ip)} ${icon('copy', 12)}</button>
    <span class="muted mono">${d.tier.toUpperCase()}</span>
  </div>
  ${alarmsBlock(model, [d.id, ...linkAlarmIds])}
  <section class="sec stats">
    <div class="stat"><label>CPU</label><b data-live="cpu">${d.reachable ? pct(d.cpu) : '—'}</b><div data-spark="cpu">${sparkline(d.cpuHistory)}</div></div>
    <div class="stat"><label>Memory</label><b data-live="mem">${d.reachable ? pct(d.mem) : '—'}</b>${bar('mem', d.mem)}</div>
    <div class="stat"><label>Uptime</label><b data-live="uptime">${d.reachable ? formatDuration(Date.now() - d.bootedAt) : '—'}</b></div>
    <div class="stat"><label>Throughput</label><b data-live="tput">${formatBps(nbs.reduce((s, n) => s + n.link.util * n.link.capacityGbps, 0))}</b></div>
  </section>
  <section class="sec">
    <h4>Top interfaces</h4>
    ${top.map((n) => ifaceRow(n)).join('')}
  </section>
  <details data-key="ifaces"><summary>All interfaces <span class="count">${nbs.length}</span></summary>
    <div class="details-body">${nbs.map((n) => ifaceRow(n)).join('')}</div>
  </details>
  <details data-key="neigh"><summary>Neighbours <span class="count">${nbs.length}</span></summary>
    <div class="details-body neigh">${nbs
      .map((n) => `<button class="neigh-item" data-goto-device="${n.device.id}">${icon(n.device.role, 14)}<span class="mono">${esc(n.device.hostname)}</span><span class="muted mono">${esc(n.remoteIface)}</span></button>`)
      .join('')}</div>
  </details>
  <details data-key="facts"><summary>Device facts</summary>
    <dl class="details-body facts">
      <dt>Model</dt><dd>${esc(d.model)}</dd>
      <dt>Software</dt><dd class="mono">${esc(d.os)}</dd>
      <dt>Serial</dt><dd class="mono">${esc(d.serial)}</dd>
      <dt>MAC</dt><dd class="mono"><button class="link-btn" data-copy="${esc(d.mac)}">${esc(d.mac)}</button></dd>
      <dt>VLANs</dt><dd class="mono">${d.vlans.map((v) => `<button class="link-btn" data-query="vlan ${v}">${v}</button>`).join(' ')}</dd>
    </dl>
  </details>
  <footer class="actions">
    <button class="btn" data-act="trace" data-tip="Trace path from here" data-key="T">${icon('trace')} Trace</button>
    <button class="btn" data-act="neighbours" data-tip="Highlight neighbours" data-key="N">${icon('neighbours')} Neighbours</button>
    <button class="btn" data-act="show" data-tip="Run show command" data-key="C">${icon('terminal')} Show</button>
    <button class="btn" data-act="ssh" data-tip="Open SSH session">${icon('ssh')} SSH</button>
  </footer>`;
}

export function liveDevice(model: Model, d: Device): Live {
  const live: Live = {
    cpu: d.reachable ? pct(d.cpu) : '—',
    mem: d.reachable ? pct(d.mem) : '—',
    'bar:mem': d.mem,
    uptime: d.reachable ? formatDuration(Date.now() - d.bootedAt) : '—',
    tput: formatBps(model.linksOf(d.id).reduce((s, l) => s + l.util * l.capacityGbps, 0)),
    'spark:cpu': sparkline(d.cpuHistory),
  };
  for (const l of model.linksOf(d.id)) {
    live[`u-${l.id}`] = l.status === 'down' ? '—' : pct(l.util);
    live[`bar:u-${l.id}`] = l.util;
  }
  for (const a of model.topo.alarms) live[`ago-${a.id}`] = timeAgo(a.raisedAt);
  return live;
}

// ── link ──

export function renderLink(model: Model, l: Link): string {
  const h = model.linkHealth(l.id);
  const a = model.devices.get(l.a.deviceId)!;
  const b = model.devices.get(l.b.deviceId)!;
  const kind = { wan: 'WAN circuit', fabric: 'Fabric link', access: 'Access link' }[l.kind];
  return `
  <header class="ph">
    <div class="ph-icon h-${h}">${icon('link', 22)}</div>
    <div class="ph-main">
      <div class="ph-title">${kind}</div>
      <div class="ph-sub mono">${l.capacityGbps} Gb/s</div>
    </div>
    ${healthPill(h, l.status === 'down' ? 'Down' : undefined)}
  </header>
  <section class="sec ends">
    <button class="end" data-goto-device="${a.id}">${icon(a.role, 14)}<span class="mono">${esc(a.hostname)}</span><span class="muted mono">${esc(l.a.iface)}</span></button>
    <span class="end-sep">⇄</span>
    <button class="end" data-goto-device="${b.id}">${icon(b.role, 14)}<span class="mono">${esc(b.hostname)}</span><span class="muted mono">${esc(l.b.iface)}</span></button>
  </section>
  ${alarmsBlock(model, [l.id])}
  <section class="sec stats">
    <div class="stat wide"><label>Utilisation</label><b data-live="util">${l.status === 'down' ? '—' : pct(l.util)}</b>${bar('util', l.util, linkUtilClass(l))}</div>
    <div class="stat"><label>In</label><b data-live="in">${formatBps(l.util * l.capacityGbps * 0.56)}</b></div>
    <div class="stat"><label>Out</label><b data-live="out">${formatBps(l.util * l.capacityGbps * 0.44)}</b></div>
    <div class="stat"><label>Errors</label><b>${l.errors}</b></div>
    <div class="stat"><label>Flaps (1h)</label><b data-live="flaps">${l.flaps}</b></div>
  </section>
  <footer class="actions">
    <button class="btn" data-act="trace-link" data-tip="Trace path across this link">${icon('trace')} Trace</button>
    <button class="btn" data-goto-device="${a.id}">${icon('inspect')} ${esc(a.hostname)}</button>
    <button class="btn" data-goto-device="${b.id}">${icon('inspect')} ${esc(b.hostname)}</button>
  </footer>`;
}

export function liveLink(_model: Model, l: Link): Live {
  return {
    util: l.status === 'down' ? '—' : pct(l.util),
    'bar:util': l.util,
    in: formatBps(l.util * l.capacityGbps * 0.56),
    out: formatBps(l.util * l.capacityGbps * 0.44),
    flaps: l.flaps,
  };
}

// ── site ──

export function renderSite(model: Model, siteId: string): string {
  const s = model.sites.get(siteId)!;
  const h = model.siteHealth(siteId);
  const devs = model.devicesInSite(siteId);
  const roles = (['router', 'firewall', 'switch', 'ap', 'server'] as const).map((r) => [r, devs.filter((d) => d.role === r).length] as const);
  const wan = model.topo.links.filter((l) => l.kind === 'wan' && model.linkSites(l).includes(siteId));
  const ids = [...devs.map((d) => d.id), ...model.topo.links.filter((l) => model.linkSites(l).includes(siteId)).map((l) => l.id)];
  const unreachable = devs.filter((d) => !d.reachable).length;
  return `
  <header class="ph">
    <div class="ph-icon h-${h}">${icon('site', 22)}</div>
    <div class="ph-main">
      <div class="ph-title">${esc(s.name)}</div>
      <div class="ph-sub">${esc(s.region)} · ${esc(s.code.toUpperCase())} · ${devs.length} devices</div>
    </div>
    ${healthPill(h)}
  </header>
  <section class="sec role-counts">${roles.map(([r, n]) => `<span class="rc" data-query="${r}s in ${esc(s.name)}" data-tip="Show ${r}s">${icon(r, 14)}<b>${n}</b></span>`).join('')}${unreachable ? `<span class="rc h-unreachable">◌ <b>${unreachable}</b></span>` : ''}</section>
  ${alarmsBlock(model, ids)}
  <section class="sec">
    <h4>WAN circuits</h4>
    ${wan
      .map((l) => {
        const other = model.devices.get(model.devices.get(l.a.deviceId)!.siteId === siteId ? l.b.deviceId : l.a.deviceId)!;
        return `<div class="if-row" data-goto-link="${l.id}"><span class="if-name">${esc(model.sites.get(other.siteId)!.name)}</span><span class="muted mono">${l.capacityGbps}G</span>${bar(`u-${l.id}`, l.util, linkUtilClass(l))}<span class="mono if-util" data-live="u-${l.id}">${pct(l.util)}</span></div>`;
      })
      .join('')}
  </section>
  <details data-key="racks" open><summary>Racks <span class="count">${s.racks.length}</span></summary>
    <div class="details-body neigh">${s.racks
      .map((r) => {
        const rh = model.rackHealth(r.id);
        return `<button class="neigh-item" data-goto-rack="${r.id}">${icon('rack', 14)}<span>${esc(r.name)}</span>${rh !== 'ok' ? healthPill(rh) : '<span class="muted">OK</span>'}</button>`;
      })
      .join('')}</div>
  </details>
  <footer class="actions">
    <button class="btn" data-act="zoom" data-key="Enter" data-tip="Zoom in">${icon('zoomIn')} Enter site</button>
    <button class="btn" data-query="alarms in ${esc(s.name)}">${icon('alarm')} Alarms</button>
    <button class="btn" data-query="wan links in ${esc(s.name)}">${icon('link')} WAN</button>
  </footer>`;
}

export function liveSite(model: Model, siteId: string): Live {
  const live: Live = {};
  for (const l of model.topo.links) {
    if (l.kind !== 'wan' || !model.linkSites(l).includes(siteId)) continue;
    live[`u-${l.id}`] = pct(l.util);
    live[`bar:u-${l.id}`] = l.util;
  }
  for (const a of model.topo.alarms) live[`ago-${a.id}`] = timeAgo(a.raisedAt);
  return live;
}

// ── rack ──

export function renderRack(model: Model, rackId: string): string {
  const r = model.racks.get(rackId)!;
  const s = model.sites.get(r.siteId)!;
  const devs = model.devicesInRack(rackId);
  const h = model.rackHealth(rackId);
  const ids = [...devs.map((d) => d.id), ...devs.flatMap((d) => model.linksOf(d.id).map((l) => l.id))];
  const kw = (devs.length * 0.42 + devs.reduce((a, d) => a + d.cpu * 0.3, 0)).toFixed(1);
  return `
  <header class="ph">
    <div class="ph-icon h-${h}">${icon('rack', 22)}</div>
    <div class="ph-main">
      <div class="ph-title">${esc(r.name)}</div>
      <div class="ph-sub">${esc(s.name)} · ${devs.length} devices · <span data-live="kw">${kw}</span> kW</div>
    </div>
    ${healthPill(h)}
  </header>
  ${alarmsBlock(model, ids)}
  <section class="sec">
    <h4>Devices</h4>
    ${devs
      .map((d) => {
        const dh = model.deviceHealth(d.id);
        return `<div class="if-row" data-goto-device="${d.id}"><span class="glyph h-${dh}">${palette().glyph[dh]}</span><span class="mono if-name">${esc(d.hostname)}</span><span class="muted mono">${esc(d.ip)}</span>${bar(`cpu-${d.id}`, d.cpu)}<span class="mono if-util" data-live="cpu-${d.id}">${d.reachable ? pct(d.cpu) : '—'}</span></div>`;
      })
      .join('')}
  </section>
  <footer class="actions">
    <button class="btn" data-act="zoom" data-key="Enter" data-tip="Zoom in">${icon('zoomIn')} Enter rack</button>
  </footer>`;
}

export function liveRack(model: Model, rackId: string): Live {
  const devs = model.devicesInRack(rackId);
  const live: Live = { kw: (devs.length * 0.42 + devs.reduce((a, d) => a + d.cpu * 0.3, 0)).toFixed(1) };
  for (const d of devs) {
    live[`cpu-${d.id}`] = d.reachable ? pct(d.cpu) : '—';
    live[`bar:cpu-${d.id}`] = d.cpu;
  }
  for (const a of model.topo.alarms) live[`ago-${a.id}`] = timeAgo(a.raisedAt);
  return live;
}

export function renderSelection(model: Model, sel: Selection): string {
  switch (sel.kind) {
    case 'device':
      return renderDevice(model, model.devices.get(sel.id)!);
    case 'link':
      return renderLink(model, model.links.get(sel.id)!);
    case 'site':
      return renderSite(model, sel.id);
    case 'rack':
      return renderRack(model, sel.id);
  }
}

export function liveSelection(model: Model, sel: Selection): Live {
  switch (sel.kind) {
    case 'device':
      return liveDevice(model, model.devices.get(sel.id)!);
    case 'link':
      return liveLink(model, model.links.get(sel.id)!);
    case 'site':
      return liveSite(model, sel.id);
    case 'rack':
      return liveRack(model, sel.id);
  }
}

/** Apply live values to an already-rendered panel. */
export function applyLive(root: HTMLElement, live: Live) {
  for (const [k, v] of Object.entries(live)) {
    if (k.startsWith('bar:')) {
      const e = root.querySelector<HTMLElement>(`[data-bar="${k.slice(4)}"]`);
      if (e) e.style.width = `${Math.round(Number(v) * 100)}%`;
    } else if (k.startsWith('spark:')) {
      const e = root.querySelector<HTMLElement>(`[data-spark="${k.slice(6)}"]`);
      if (e) e.innerHTML = String(v);
    } else {
      root.querySelectorAll<HTMLElement>(`[data-live="${k}"]`).forEach((e) => {
        if (e.textContent !== String(v)) e.textContent = String(v);
      });
    }
  }
}

// ── simulated show commands ──

export function showCommands(d: Device): string[] {
  if (d.role === 'server') return ['uptime', 'ip -br addr', 'ss -s', 'ethtool -S ens1f0 | grep err'];
  if (d.role === 'ap') return ['show version', 'show clients summary', 'show radio'];
  if (d.role === 'firewall') return ['show system info', 'show session info', 'show interface all', 'show session top-sources'];
  return ['show version', 'show interfaces brief', 'show lldp neighbors', 'show ip route summary', 'show processes cpu sorted'];
}

export function showOutput(model: Model, d: Device, cmd: string): string {
  const nbs = model.neighbours(d.id);
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  if (!d.reachable) return `% Connection to ${d.ip} timed out (no response after 10s)`;
  switch (cmd) {
    case 'show version':
    case 'show system info':
      return `Hostname: ${d.hostname}\nModel: ${d.model}\nSoftware: ${d.os}\nSerial: ${d.serial}\nUptime: ${formatDuration(Date.now() - d.bootedAt)}\nBase MAC: ${d.mac}`;
    case 'show interfaces brief':
    case 'show interface all':
      return [`${pad('Interface', 14)}${pad('Status', 8)}${pad('Speed', 8)}${pad('Util', 7)}Description`, ...nbs.map((n) => `${pad(n.localIface, 14)}${pad(n.link.status === 'down' ? 'down' : 'up', 8)}${pad(`${n.link.capacityGbps}G`, 8)}${pad(n.link.status === 'down' ? '-' : pct(n.link.util), 7)}to ${n.device.hostname} ${n.remoteIface}`)].join('\n');
    case 'show lldp neighbors':
      return [`${pad('Local Intf', 14)}${pad('Neighbor', 20)}${pad('Neighbor Intf', 16)}TTL`, ...nbs.filter((n) => n.link.status === 'up').map((n) => `${pad(n.localIface, 14)}${pad(n.device.hostname, 20)}${pad(n.remoteIface, 16)}120`)].join('\n');
    case 'show ip route summary':
      return `Route Source      Networks\nconnected         ${nbs.length + 2}\nstatic            4\nbgp               ${d.tier === 'core' ? 812 : 96}\nospf              ${d.tier === 'core' ? 41 : 18}\nTotal             ${nbs.length + 2 + 4 + (d.tier === 'core' ? 853 : 114)}`;
    case 'show processes cpu sorted':
      return `CPU utilization: ${pct(d.cpu)} (5s)\n  PID  CPU%  Process\n 1123  ${(d.cpu * 38).toFixed(1).padStart(4)}  bgpd\n  981  ${(d.cpu * 21).toFixed(1).padStart(4)}  fwdd\n 1402  ${(d.cpu * 12).toFixed(1).padStart(4)}  snmpd\n  733  ${(d.cpu * 6).toFixed(1).padStart(4)}  lldpd`;
    case 'show session info':
      return `Session table: ${d.id === 'fra-fw-01' ? '91' : '42'}% in use\nActive sessions: ${d.id === 'fra-fw-01' ? '3,640,118' : '1,682,404'} / 4,000,000\nNew sessions/s: 18,204`;
    case 'show session top-sources':
      return `Source            Sessions\n10.3.2.40         ${d.id === 'fra-fw-01' ? '1,204,881' : '12,004'}\n10.3.1.20         88,410\n10.3.4.10         61,202`;
    case 'uptime':
      return ` ${new Date().toTimeString().slice(0, 8)} up ${formatDuration(Date.now() - d.bootedAt)},  load average: ${(d.cpu * 16).toFixed(2)}, ${(d.cpu * 15).toFixed(2)}, ${(d.cpu * 14).toFixed(2)}`;
    case 'ip -br addr':
      return `lo        UNKNOWN  127.0.0.1/8\nens1f0    UP       ${d.ip}/24\nens1f1    DOWN`;
    case 'ss -s':
      return `Total: ${Math.round(400 + d.cpu * 3000)}\nTCP:   ${Math.round(200 + d.cpu * 2200)} (estab ${Math.round(150 + d.cpu * 1800)}, closed 12, timewait 40)`;
    case 'show clients summary':
      return `Clients: ${Math.round(12 + d.cpu * 60)}  (2.4GHz ${Math.round(4 + d.cpu * 10)} · 5GHz ${Math.round(6 + d.cpu * 30)} · 6GHz ${Math.round(2 + d.cpu * 20)})`;
    case 'show radio':
      return `Radio  Band   Channel  Power  Util\n0      2.4G   6        14dBm  ${pct(d.cpu * 0.8)}\n1      5G     44/80    17dBm  ${pct(d.cpu)}\n2      6G     37/160   18dBm  ${pct(d.cpu * 0.6)}`;
    default:
      return `ens1f0 rx_crc_errors: 0\nens1f0 tx_errors: 0`;
  }
}
