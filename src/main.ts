/**
 * Packet Atlas entry point.
 *
 * URL parameters:
 *   ?topology=<url>   load a Topology JSON (see docs/DATA_MODEL.md) instead of the demo network
 *   ?empty=1          start in the empty state (shows the "Load demo network" call to action)
 *   ?wallboard=1      start in wallboard mode (also automatic on very large screens)
 *   ?tour=1           force the guided tour
 *   ?fx=ultra|balanced|performance   override the effects level for this device
 */
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles.css';
import { generateTopology } from './data/mock';
import { Model } from './data/model';
import { TelemetrySim } from './data/telemetry';
import type { Topology } from './data/types';
import { normalizeTopology, type TopologyInput } from './data/normalize';
import { prefs, type EffectsLevel } from './core/prefs';
import { sound } from './core/audio';
import { App } from './ui/app';
import { emptyState } from './ui/overlays';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
const ui = document.getElementById('ui')!;

const fx = params.get('fx');
if (fx === 'ultra' || fx === 'balanced' || fx === 'performance') {
  prefs.set('effects', fx as EffectsLevel);
  prefs.set('effectsPinned', true);
} else if (!prefs.get('effectsPinned') && (navigator.hardwareConcurrency ?? 8) <= 4) {
  // Conservative first guess for low-power machines; the FPS monitor refines it at runtime.
  prefs.set('effects', 'balanced');
}

/** Wall displays: very large viewports start in wallboard mode automatically. */
const autoWallboard = params.get('wallboard') === '1' || (innerWidth >= 2560 && innerHeight >= 1300);

async function loadTopology(): Promise<{ topo: Topology | null; demo: boolean; reason?: string }> {
  if (params.get('empty') === '1') return { topo: null, demo: false, reason: 'Started without a data source.' };
  const url = params.get('topology');
  if (!url) return { topo: generateTopology(), demo: true };
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as TopologyInput;
    if (!Array.isArray(raw.sites) || !Array.isArray(raw.devices) || !raw.devices.length) throw new Error('no devices in topology');
    return { topo: normalizeTopology({ ...raw, links: raw.links ?? [] }), demo: false };
  } catch (err) {
    return { topo: null, demo: false, reason: `Could not load ${url}: ${(err as Error).message}.` };
  }
}

async function main() {
  const model = new Model();
  const { topo, demo, reason } = await loadTopology();
  const startWith = (t: Topology, isDemo: boolean) => {
    model.load(t);
    const app = new App(model, ui, stage, isDemo);
    if (isDemo) new TelemetrySim(model).start();
    void app.boot({ wallboard: autoWallboard, forceTour: params.get('tour') === '1' });
    if (import.meta.env.DEV) (window as unknown as { app: App }).app = app;
  };
  if (topo) startWith(topo, demo);
  else emptyState(ui, reason ?? '', () => startWith(generateTopology(), true));
  if (prefs.get('sound')) {
    // Browsers require a gesture before audio can start.
    window.addEventListener('pointerdown', () => sound.sync(), { once: true });
  }
}

void main();
