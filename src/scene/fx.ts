/** Resolved rendering/motion settings derived from user preferences. */
import { prefs } from '../core/prefs';

export interface Fx {
  bloom: boolean;
  bloomHalfRes: boolean;
  dof: boolean;
  pixelRatio: number;
  /** Multiplier on particle counts. */
  particles: number;
  /** Multiplier on particle speed. */
  particleSpeed: number;
  /** Idle animations: rotation, breathing glow, scanning lines. */
  idle: boolean;
  /** Glitch/flicker for flapping, expanding shockwaves for critical alarms. */
  glitch: boolean;
  ripple: boolean;
  dust: boolean;
  /** Camera transition duration in ms (always within 200–600 ms). */
  camMs: number;
}

export function resolveFx(): Fx {
  const level = prefs.get('effects');
  const off = prefs.get('effectsOff');
  const reduced = prefs.get('reducedMotion');
  const dpr = window.devicePixelRatio || 1;
  return {
    bloom: !off && level !== 'performance',
    bloomHalfRes: level === 'balanced',
    dof: !off && level === 'ultra',
    pixelRatio: level === 'ultra' ? Math.min(dpr, 2) : level === 'balanced' ? Math.min(dpr, 1.5) : 1,
    particles: level === 'performance' ? 0.5 : 1,
    particleSpeed: reduced ? 0.35 : 1,
    idle: !reduced,
    glitch: !off && !reduced,
    ripple: !off && !reduced,
    dust: !off && level !== 'performance',
    camMs: reduced ? 200 : 600,
  };
}
