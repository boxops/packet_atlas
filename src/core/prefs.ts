/** Persisted user preferences: last view, bookmarks, theme, effects level, accessibility. */
import type { ViewTarget } from '../data/types';
import { Emitter } from './util';

export type EffectsLevel = 'ultra' | 'balanced' | 'performance';
export type Accent = 'cyan' | 'emerald' | 'violet';

export interface CameraState {
  pos: [number, number, number];
  target: [number, number, number];
}

export interface Bookmark {
  id: string;
  name: string;
  view: ViewTarget;
  camera: CameraState;
  createdAt: number;
}

export interface Prefs {
  effects: EffectsLevel;
  /** True once the user picked an effects level themselves (disables auto-downgrade). */
  effectsPinned: boolean;
  colorBlind: boolean;
  reducedMotion: boolean;
  effectsOff: boolean;
  scanlines: boolean;
  sound: boolean;
  accent: Accent;
  legend: boolean;
  tourDone: boolean;
  lastView: ViewTarget | null;
  lastCamera: CameraState | null;
  bookmarks: Bookmark[];
}

const KEY = 'packet-atlas:prefs:v1';

function defaults(): Prefs {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    effects: 'ultra',
    effectsPinned: false,
    colorBlind: false,
    reducedMotion: reduce,
    effectsOff: false,
    scanlines: true,
    sound: false, // ambient sound is muted by default
    accent: 'cyan',
    legend: false,
    tourDone: false,
    lastView: null,
    lastCamera: null,
    bookmarks: [],
  };
}

class PrefStore extends Emitter<{ change: { key: keyof Prefs; prefs: Prefs } }> {
  value: Prefs;
  private saveTimer = 0;

  constructor() {
    super();
    let stored: Partial<Prefs> = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      /* ignore corrupt prefs */
    }
    this.value = { ...defaults(), ...stored };
  }

  get<K extends keyof Prefs>(key: K): Prefs[K] {
    return this.value[key];
  }

  set<K extends keyof Prefs>(key: K, v: Prefs[K]) {
    if (this.value[key] === v) return;
    this.value[key] = v;
    this.emit('change', { key, prefs: this.value });
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 250);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* storage full / private mode */
    }
  }

  reset() {
    localStorage.removeItem(KEY);
    this.value = defaults();
    for (const key of Object.keys(this.value) as (keyof Prefs)[]) this.emit('change', { key, prefs: this.value });
  }
}

export const prefs = new PrefStore();

/** Accessibility mode = colour-blind palette + reduced motion + effects off. */
export function accessibilityMode(): boolean {
  return prefs.get('colorBlind') && prefs.get('reducedMotion') && prefs.get('effectsOff');
}

export function setAccessibilityMode(on: boolean) {
  prefs.set('colorBlind', on);
  prefs.set('reducedMotion', on);
  prefs.set('effectsOff', on);
}
