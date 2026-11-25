/**
 * Stylised device objects. Silhouette encodes role:
 *   router   → puck with an orbiting ring
 *   firewall → hexagonal pillar with shield bands
 *   switch   → flat slab with a glowing port strip
 *   ap       → dome emitting broadcast rings
 *   server   → rack-unit slab with a scanning line
 * Health drives glow colour and behaviour (breathing, pulse, shockwave, glitch, ghost).
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Device, Health, Role } from '../data/types';
import type { Palette } from '../core/palette';
import type { Fx } from './fx';
import { glowTexture, portTexture } from './textures';
import { esc } from '../core/util';

interface RoleGeo {
  body: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  wire: THREE.BufferGeometry;
  hit: THREE.BufferGeometry;
  /** Approximate half-height, used for label/beacon placement. */
  top: number;
}

const geoCache = new Map<Role, RoleGeo>();

function roleGeo(role: Role): RoleGeo {
  let g = geoCache.get(role);
  if (g) return g;
  let body: THREE.BufferGeometry;
  let top: number;
  switch (role) {
    case 'router':
      body = new THREE.CylinderGeometry(2.1, 2.35, 1.3, 40);
      top = 0.9;
      break;
    case 'firewall':
      body = new THREE.CylinderGeometry(1.9, 1.9, 3.2, 6);
      top = 1.8;
      break;
    case 'switch':
      body = new THREE.BoxGeometry(5.2, 0.9, 2.8);
      top = 0.7;
      break;
    case 'ap':
      body = new THREE.SphereGeometry(1.25, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      top = 1.4;
      break;
    case 'server':
      body = new THREE.BoxGeometry(3.8, 1.0, 2.6);
      top = 0.6;
      break;
  }
  const hitSize = new THREE.Box3().setFromBufferAttribute(body.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3());
  g = {
    body,
    edges: new THREE.EdgesGeometry(body, 28),
    wire: new THREE.WireframeGeometry(body),
    hit: new THREE.BoxGeometry(hitSize.x + 0.6, Math.max(hitSize.y, 1.2) + 0.4, hitSize.z + 0.6),
    top,
  };
  geoCache.set(role, g);
  return g;
}

const ringGeo = new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
const orbitGeo = new THREE.TorusGeometry(3.0, 0.06, 6, 72).rotateX(Math.PI / 2);
const broadcastGeo = new THREE.TorusGeometry(1, 0.035, 4, 48).rotateX(Math.PI / 2);
const scanGeo = new THREE.PlaneGeometry(0.14, 0.62);
const stripGeo = new THREE.PlaneGeometry(4.6, 0.32);
const bandGeo = new THREE.CylinderGeometry(1.98, 1.98, 0.12, 6, 1, true);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

/** Bright, bloom-friendly version of a colour (values > 1 pass the bloom threshold). */
export function neon(hex: string, k = 2.2): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(k);
}

export class DeviceVisual {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh;
  readonly label: CSS2DObject;
  readonly top: number;
  health: Health = 'ok';
  selected = false;
  hovered = false;
  /** 0 = normal, 1 = fully dimmed (not part of the current highlight). */
  private dim = 0;
  dimTarget = 0;
  appear = 0;

  private body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private ghost: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private halo: THREE.Sprite;
  private ripple: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private animated: { obj: THREE.Object3D; kind: 'orbit' | 'broadcast' | 'scan' }[] = [];
  private accentMats: (THREE.MeshBasicMaterial | THREE.LineBasicMaterial)[] = [];
  private glitchUntil = 0;
  private phase = Math.random() * Math.PI * 2;
  private color = new THREE.Color();
  private labelEl: HTMLDivElement;

  constructor(readonly device: Device, worldPos: THREE.Vector3) {
    const g = roleGeo(device.role);
    this.top = g.top * device.scale;
    this.group.position.copy(worldPos);
    this.group.scale.setScalar(device.scale);

    this.body = new THREE.Mesh(g.body, new THREE.MeshStandardMaterial({ color: '#0b1628', metalness: 0.75, roughness: 0.32, emissive: '#000', transparent: true }));
    this.edges = new THREE.LineSegments(g.edges, new THREE.LineBasicMaterial({ transparent: true }));
    this.ghost = new THREE.LineSegments(g.wire, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }));
    this.ghost.visible = false;
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.halo.scale.setScalar(device.role === 'server' ? 4.5 : 8);
    this.ripple = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.ripple.visible = false;
    this.group.add(this.body, this.edges, this.ghost, this.halo, this.ripple);
    this.buildRoleExtras(device.role);

    this.hit = new THREE.Mesh(g.hit, hitMat);
    this.hit.userData = { kind: 'device', id: device.id };
    this.group.add(this.hit);

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'label label-device';
    this.label = new CSS2DObject(this.labelEl);
    this.label.position.set(0, g.top + 1.1, 0);
    this.label.center.set(0.5, 1);
    this.group.add(this.label);
    this.label.visible = false;
  }

  private buildRoleExtras(role: Role) {
    const accent = () => {
      const m = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      this.accentMats.push(m);
      return m;
    };
    if (role === 'router') {
      const orbit = new THREE.Mesh(orbitGeo, accent());
      orbit.rotation.z = 0.12;
      this.group.add(orbit);
      this.animated.push({ obj: orbit, kind: 'orbit' });
    } else if (role === 'firewall') {
      for (const y of [-0.7, 0.7]) {
        const band = new THREE.Mesh(bandGeo, accent());
        band.position.y = y;
        this.group.add(band);
      }
    } else if (role === 'switch') {
      const m = accent();
      m.map = portTexture();
      const strip = new THREE.Mesh(stripGeo, m);
      strip.position.set(0, 0, 1.41);
      this.group.add(strip);
    } else if (role === 'ap') {
      for (let i = 0; i < 2; i++) {
        const ring = new THREE.Mesh(broadcastGeo, accent());
        ring.userData.offset = i * 0.5;
        this.group.add(ring);
        this.animated.push({ obj: ring, kind: 'broadcast' });
      }
    } else if (role === 'server') {
      const led = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.08), accent());
      led.position.set(-0.5, -0.32, 1.31);
      const scan = new THREE.Mesh(scanGeo, accent());
      scan.position.set(0, 0.05, 1.32);
      this.group.add(led, scan);
      this.animated.push({ obj: scan, kind: 'scan' });
    }
  }

  setHealth(h: Health, p: Palette) {
    const changed = h !== this.health;
    this.health = h;
    this.color.set(p.health[h]);
    const ghost = h === 'unreachable';
    this.edges.visible = !ghost;
    this.ghost.visible = ghost;
    this.ghost.material.color.copy(neon(p.health.unreachable, 1.2));
    this.edges.material.color.copy(neon(p.health[h], h === 'ok' ? 1.6 : 2.4));
    this.body.material.emissive.set(p.health[h]);
    this.body.material.emissiveIntensity = ghost ? 0 : h === 'ok' ? 0.08 : 0.22;
    (this.halo.material as THREE.SpriteMaterial).color.copy(neon(p.health[h], 1.2));
    this.ripple.material.color.copy(neon(p.health.critical, 2.5));
    for (const m of this.accentMats) m.color.copy(neon(h === 'ok' ? p.accent : p.health[h], 2));
    if (changed && h !== 'ok') this.glitchUntil = performance.now() + 400;
    this.renderLabel(p);
  }

  renderLabel(p: Palette) {
    const h = this.health;
    this.labelEl.dataset.health = h;
    this.labelEl.innerHTML = `${h !== 'ok' ? `<span class="glyph" style="color:${p.health[h]}">${p.glyph[h]}</span>` : ''}${esc(this.device.hostname)}`;
  }

  /** Per-frame animation. `t` in seconds. */
  update(t: number, dt: number, fx: Fx) {
    this.dim += (this.dimTarget - this.dim) * Math.min(1, dt / 0.12);
    const vis = (1 - this.dim * 0.88) * this.appear;
    const h = this.health;
    const now = performance.now();

    // Breathing / pulsing halo.
    let pulse: number;
    if (h === 'critical') pulse = fx.idle ? 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 1.6) ** 2 : 0.85;
    else if (h === 'warning') pulse = fx.idle ? 0.45 + 0.4 * Math.sin(t * 2 * Math.PI * 1.0 + this.phase) ** 2 : 0.7;
    else if (h === 'unreachable') pulse = 0;
    else pulse = fx.idle ? 0.28 + 0.1 * Math.sin(t * 1.2 + this.phase) : 0.3;
    const hm = this.halo.material as THREE.SpriteMaterial;
    hm.opacity = pulse * vis * (this.hovered || this.selected ? 1.5 : 1);
    this.halo.visible = hm.opacity > 0.01;

    this.edges.material.opacity = vis;
    this.body.material.opacity = h === 'unreachable' ? 0.07 * vis : Math.max(0.06, vis);
    this.body.material.depthWrite = vis > 0.5 && h !== 'unreachable';
    for (const m of this.accentMats) m.opacity = (h === 'unreachable' ? 0.15 : 0.9) * vis;

    // Ghost: translucent wireframe with a faint shimmer.
    if (this.ghost.visible) this.ghost.material.opacity = (0.22 + (fx.idle ? 0.1 * Math.sin(t * 3 + this.phase) : 0)) * vis;

    // Critical shockwave ripple.
    if (h === 'critical') {
      this.ripple.visible = vis > 0.2;
      if (fx.ripple) {
        const k = ((t + this.phase) % 2.2) / 2.2;
        this.ripple.scale.setScalar(1.5 + k * 9);
        this.ripple.material.opacity = (1 - k) ** 2 * 0.9 * vis;
      } else {
        this.ripple.scale.setScalar(4);
        this.ripple.material.opacity = 0.5 * vis;
      }
    } else this.ripple.visible = false;

    // Glitch: flapping devices (and the moment a device changes state) jitter and flicker.
    const glitching = fx.glitch && (this.device.flapping ? Math.random() < 0.06 : now < this.glitchUntil && Math.random() < 0.4);
    this.body.position.x = glitching ? (Math.random() - 0.5) * 0.5 : 0;
    this.edges.position.x = glitching ? (Math.random() - 0.5) * 0.7 : 0;
    if (glitching) this.edges.material.opacity *= 0.3;

    // Hover lift.
    const s = this.device.scale * (this.hovered ? 1.07 : 1) * (0.6 + 0.4 * this.appear);
    this.group.scale.setScalar(this.group.scale.x + (s - this.group.scale.x) * Math.min(1, dt / 0.1));

    if (!fx.idle) return;
    for (const a of this.animated) {
      if (a.kind === 'orbit') a.obj.rotation.y = t * 0.6 + this.phase;
      else if (a.kind === 'broadcast') {
        const k = (t * 0.45 + a.obj.userData.offset + this.phase) % 1;
        a.obj.scale.setScalar(1 + k * 2.6);
        a.obj.position.y = 0.2 + k * 0.6;
        ((a.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9 * vis;
      } else if (a.kind === 'scan') a.obj.position.x = Math.sin(t * 1.4 + this.phase) * 1.7;
    }
  }

  dispose() {
    this.labelEl.remove();
  }
}
