/**
 * Optional ambient sound design, synthesised with WebAudio (no assets to download).
 * Muted by default; the AudioContext is only created once the user unmutes.
 */
import { prefs } from './prefs';

class SoundDesign {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: { stop(): void } | null = null;

  private ensure() {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  get enabled() {
    return prefs.get('sound');
  }

  sync() {
    if (this.enabled) {
      const ctx = this.ensure();
      void ctx.resume();
      this.startHum();
    } else {
      this.hum?.stop();
      this.hum = null;
    }
  }

  private startHum() {
    if (this.hum || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 1.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const oscs = [55, 55.4, 110.2].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain).connect(this.master);
    this.hum = {
      stop: () => {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
        oscs.forEach((o) => o.stop(ctx.currentTime + 0.35));
      },
    };
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, at = 0) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click() {
    this.blip(1500, 0.04, 'sine', 0.08);
  }

  whoosh() {
    this.blip(320, 0.18, 'triangle', 0.04);
  }

  alarm(critical: boolean) {
    this.blip(critical ? 880 : 660, 0.22, 'triangle', 0.12);
    this.blip(critical ? 660 : 520, 0.28, 'triangle', 0.1, 0.24);
  }
}

export const sound = new SoundDesign();
