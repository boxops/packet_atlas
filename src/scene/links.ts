/**
 * Links as neon light tubes: thickness = capacity, colour = utilisation (alert colours only when
 * an alert applies), particle stream speed + density = live throughput.
 * All particles live in one Points object and are positioned on the CPU each frame (a few
 * thousand Bézier evaluations — trivially cheap, and lets speed change without jumps).
 */
import * as THREE from 'three';
import type { Model } from '../data/model';
import type { Health, Link } from '../data/types';
import type { Palette } from '../core/palette';
import type { Fx } from './fx';
import { neon } from './devices';

export interface LinkVisual {
  link: Link;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  length: number;
  tube: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  baseRadius: number;
  /** Particle slot range. */
  start: number;
  max: number;
  phases: Float32Array;
  offset: number;
  health: Health;
  dim: number;
  dimTarget: number;
  onPath: boolean;
  reversed: boolean;
  appear: number;
}

const tmpC = new THREE.Color();

export function utilColor(u: number, p: Palette, out = new THREE.Color()): THREE.Color {
  const [a, b, c] = p.util;
  if (u < 0.5) return out.set(a).lerp(tmpC.set(b), u / 0.5);
  return out.set(b).lerp(tmpC.set(c), Math.min(1, (u - 0.5) / 0.4));
}

function bezier(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number) {
  const it = 1 - t;
  const k0 = it * it;
  const k1 = 2 * it * t;
  const k2 = t * t;
  out.set(a.x * k0 + b.x * k1 + c.x * k2, a.y * k0 + b.y * k1 + c.y * k2, a.z * k0 + b.z * k1 + c.z * k2);
}

export class LinkLayer {
  readonly group = new THREE.Group();
  readonly visuals = new Map<string, LinkVisual>();
  readonly hits: THREE.Mesh[] = [];
  private points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private total = 0;
  private tmp = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(
    private model: Model,
    worldPos: (deviceId: string) => THREE.Vector3,
  ) {
    let slot = 0;
    for (const link of model.topo.links) {
      const a = worldPos(link.a.deviceId);
      const b = worldPos(link.b.deviceId);
      const da = model.devices.get(link.a.deviceId)!;
      const db = model.devices.get(link.b.deviceId)!;
      let p0 = a.clone();
      let p2 = b.clone();
      let p1: THREE.Vector3;
      if (link.kind === 'wan') {
        const dist = a.distanceTo(b);
        p1 = a.clone().add(b).multiplyScalar(0.5);
        p1.y += 30 + dist * 0.22;
      } else if (db.role === 'server') {
        // Cable bundle down the back of the rack, one lane per server.
        const k = da.interfaces.findIndex((i) => i.linkId === link.id) - 2;
        const lane = -1.7 + k * 0.85;
        p0 = a.clone().add(new THREE.Vector3(lane, -0.45, -1.5));
        p2 = b.clone().add(new THREE.Vector3(lane, 0, -1.35));
        p1 = p0.clone().lerp(p2, 0.5);
      } else {
        p1 = a.clone().lerp(b, 0.5);
      }
      const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
      const length = curve.getLength();
      const wan = link.kind === 'wan';
      const baseRadius = (0.05 + 0.045 * Math.log10(link.capacityGbps + 1)) * (wan ? 4 : 1);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, wan ? 64 : 2, baseRadius, wan ? 10 : 6, false),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      tube.userData = { kind: 'link', id: link.id };
      // Fatter invisible tube for easier picking.
      const hit = new THREE.Mesh(new THREE.TubeGeometry(curve, wan ? 32 : 2, Math.max(0.6, baseRadius * 3), 4, false), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData = { kind: 'link', id: link.id };
      this.group.add(tube, hit);
      this.hits.push(hit);
      const max = Math.max(4, Math.min(wan ? 48 : 30, Math.round(length / (wan ? 7 : 1.8))));
      const phases = new Float32Array(max);
      for (let i = 0; i < max; i++) phases[i] = (i + Math.random() * 0.6) / max;
      this.visuals.set(link.id, { link, p0, p1, p2, length, tube, baseRadius, start: slot, max, phases, offset: Math.random(), health: 'ok', dim: 0, dimTarget: 0, onPath: false, reversed: false, appear: 0 });
      slot += max;
    }
    this.total = slot;
    this.positions = new Float32Array(slot * 3);
    this.colors = new Float32Array(slot * 3);
    this.sizes = new Float32Array(slot);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: { uScale: { value: 500 } },
        vertexShader: /* glsl */ `
          attribute float size;
          uniform float uScale;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(size * uScale / -mv.z, 0.0, 14.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            float a = smoothstep(0.5, 0.0, d);
            a = a * a;
            gl_FragColor = vec4(vColor * a, a);
          }`,
      }),
    );
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** Recompute colours from utilisation/health. Called on each telemetry tick. */
  refresh(p: Palette) {
    for (const v of this.visuals.values()) {
      const l = v.link;
      v.health = this.model.linkHealth(l.id);
      const c = v.onPath
        ? neon(p.magenta, 1.6)
        : l.status === 'down'
          ? neon(p.health.critical, 1.4)
          : v.health === 'warning'
            ? neon(p.health.warning, 1.6)
            : utilColor(l.util, p, new THREE.Color()).multiplyScalar(1.5);
      v.tube.material.color.copy(c);
    }
  }

  setScale(viewportHeight: number, fovDeg: number) {
    this.points.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  update(t: number, dt: number, fx: Fx, p: Palette) {
    const pos = this.positions;
    const col = this.colors;
    const siz = this.sizes;
    for (const v of this.visuals.values()) {
      const l = v.link;
      v.dim += (v.dimTarget - v.dim) * Math.min(1, dt / 0.12);
      const vis = (1 - v.dim * 0.92) * v.appear;
      const m = v.tube.material;

      let op = (v.onPath ? 0.9 : 0.5) * vis;
      if (l.status === 'down') op = (fx.idle ? 0.22 + 0.18 * (Math.sin(t * 4) > 0 ? 1 : 0) : 0.3) * vis;
      if (l.flapping && fx.glitch && Math.random() < 0.18) op *= Math.random() * 0.25;
      m.opacity = op;
      v.tube.visible = op > 0.005;

      // Particles.
      const up = l.status === 'up' && vis > 0.05;
      const flowing = up && !(l.flapping && fx.glitch && Math.random() < 0.3);
      const util = Math.max(0.04, l.util);
      const active = up ? Math.max(2, Math.round(v.max * fx.particles * (0.12 + 0.88 * util))) : 0;
      const speed = (5 + util * 30) * fx.particleSpeed * (v.onPath ? 1.8 : 1) * (l.kind === 'wan' ? 3 : 1);
      if (flowing) v.offset = (v.offset + (dt * speed) / v.length) % 1;
      const pc = v.onPath ? this.col.set(p.magenta).multiplyScalar(2.6) : l.flapping || v.health === 'warning' ? this.col.set(p.health.warning).multiplyScalar(2.2) : utilColor(l.util, p, this.col).lerp(tmpC.set('#ffffff'), 0.45).multiplyScalar(2.2);
      const size = (l.kind === 'wan' ? 3.2 : 0.55) * (v.onPath ? 1.6 : 1) * (0.8 + util * 0.6);
      for (let i = 0; i < v.max; i++) {
        const idx = v.start + i;
        if (i >= active) {
          siz[idx] = 0;
          continue;
        }
        let tt = (v.phases[i] + v.offset) % 1;
        if (v.reversed) tt = 1 - tt;
        bezier(this.tmp, v.p0, v.p1, v.p2, tt);
        pos[idx * 3] = this.tmp.x;
        pos[idx * 3 + 1] = this.tmp.y;
        pos[idx * 3 + 2] = this.tmp.z;
        // Fade in/out at the ends so streams don't pop.
        const edge = Math.min(1, tt * 8, (1 - tt) * 8) * vis;
        col[idx * 3] = pc.r * edge;
        col[idx * 3 + 1] = pc.g * edge;
        col[idx * 3 + 2] = pc.b * edge;
        siz[idx] = size;
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.setDrawRange(0, this.total);
  }

  midpoint(linkId: string): THREE.Vector3 {
    const v = this.visuals.get(linkId)!;
    const out = new THREE.Vector3();
    bezier(out, v.p0, v.p1, v.p2, 0.5);
    return out;
  }
}
