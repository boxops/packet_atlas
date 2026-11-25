/**
 * Single source of truth for colour. Amber and red are reserved strictly for alerts;
 * utilisation uses a cool blue → cyan → white-hot ramp so it never reads as an alarm.
 */
import type { Health } from '../data/types';
import { prefs, type Accent } from './prefs';

export interface Palette {
  bg: string;
  accent: string;
  magenta: string;
  health: Record<Health, string>;
  /** Utilisation ramp stops (0 → 1). */
  util: [string, string, string];
  /** Glyphs used alongside colour, so state never relies on colour alone. */
  glyph: Record<Health, string>;
}

const ACCENTS: Record<Accent, string> = { cyan: '#00e5ff', emerald: '#2bffb4', violet: '#9d8cff' };

const STANDARD: Omit<Palette, 'accent'> = {
  bg: '#03060d',
  magenta: '#ff3df2',
  health: { ok: '#2ef2c9', warning: '#ffb020', critical: '#ff3b4e', unreachable: '#7f9bb3' },
  util: ['#1f5bff', '#00e5ff', '#eafcff'],
  glyph: { ok: '●', warning: '▲', critical: '✖', unreachable: '◌' },
};

/** Okabe–Ito based, safe for deuteranopia / protanopia / tritanopia. */
const COLOR_BLIND: Omit<Palette, 'accent'> = {
  bg: '#03060d',
  magenta: '#cc79a7',
  health: { ok: '#56b4e9', warning: '#f0e442', critical: '#d55e00', unreachable: '#a0a0a0' },
  util: ['#0072b2', '#56b4e9', '#ffffff'],
  glyph: STANDARD.glyph,
};

export function palette(): Palette {
  const base = prefs.get('colorBlind') ? COLOR_BLIND : STANDARD;
  return { ...base, accent: prefs.get('colorBlind') ? '#56b4e9' : ACCENTS[prefs.get('accent')] };
}

/** Push the palette into CSS custom properties so DOM and WebGL always agree. */
export function applyCssPalette() {
  const p = palette();
  const root = document.documentElement.style;
  root.setProperty('--accent', p.accent);
  root.setProperty('--magenta', p.magenta);
  root.setProperty('--ok', p.health.ok);
  root.setProperty('--warn', p.health.warning);
  root.setProperty('--crit', p.health.critical);
  root.setProperty('--ghost', p.health.unreachable);
  root.setProperty('--util-0', p.util[0]);
  root.setProperty('--util-1', p.util[1]);
  root.setProperty('--util-2', p.util[2]);
}
