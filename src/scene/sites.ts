/** Floating hexagonal site islands with tier layers, rack frames and a downward light cone. */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SITE_RADIUS, TIER_Y } from '../data/mock';
import type { Health, Site } from '../data/types';
import type { Palette } from '../core/palette';
import { deckTexture } from './textures';
import { GRID_Y } from './grid';
import { neon } from './devices';
import { esc } from '../core/util';

const R = SITE_RADIUS;
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

function hexPoints(radius: number, y: number): THREE.Vector3[] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    return new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
  });
}

export const RACK_SIZE = new THREE.Vector3(5.2, 9.4, 3.6);

export class SiteVisual {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh;
  readonly rackHits: THREE.Mesh[] = [];
  readonly label: CSS2DObject;
  readonly labelEl: HTMLDivElement;
  readonly tierLabels: CSS2DObject[] = [];
  readonly rackLabels: CSS2DObject[] = [];
  appear = 0;
  dimTarget = 0;
  private dim = 0;
  health: Health = 'ok';

  private rim: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private rimLow: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private deckMat: THREE.MeshBasicMaterial;
  private platMat: THREE.MeshStandardMaterial;
  private tierMats: THREE.LineDashedMaterial[] = [];
  private rackMats: THREE.LineBasicMaterial[] = [];
  private cone: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(readonly site: Site) {
    this.group.position.set(site.x, 0, site.z);

    // Platform: dark glass hex slab with a printed deck grid on top.
    this.platMat = new THREE.MeshStandardMaterial({ color: '#081426', metalness: 0.5, roughness: 0.55, transparent: true, opacity: 0.92 });
    this.deckMat = new THREE.MeshBasicMaterial({ map: deckTexture(), transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending });
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.94, 1.6, 6), [this.platMat, this.deckMat, this.platMat]);
    plat.rotation.y = Math.PI / 6;
    plat.position.y = -1.4;
    this.group.add(plat);

    const rimGeo = new THREE.BufferGeometry().setFromPoints(hexPoints(R, -0.58));
    this.rim = new THREE.LineLoop(rimGeo, new THREE.LineBasicMaterial({ transparent: true }));
    this.rimLow = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hexPoints(R * 0.94, -2.2)), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }));
    this.group.add(this.rim, this.rimLow);

    // Underside light cone that "suspends" the island over the grid.
    const h = -GRID_Y - 2;
    this.cone = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.9, R * 0.35, h, 6, 1, true),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color('#00e5ff') }, uOpacity: { value: 0.1 } },
        vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vY; void main(){ float a = pow(vY, 2.5) * uOpacity; gl_FragColor = vec4(uColor * a, a); }`,
      }),
    );
    this.cone.rotation.y = Math.PI / 6;
    this.cone.position.y = -2.2 - h / 2;
    this.group.add(this.cone);

    // Tier layers: faint dashed hex rings at each tier height.
    const tiers: [keyof typeof TIER_Y, string][] = [
      ['core', 'CORE · WAN'],
      ['distribution', 'DISTRIBUTION · SPINE'],
      ['access', 'ACCESS · LEAF'],
    ];
    for (const [tier, name] of tiers) {
      const m = new THREE.LineDashedMaterial({ dashSize: 1.6, gapSize: 1.4, transparent: true, opacity: 0.18 });
      this.tierMats.push(m);
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hexPoints(R * 0.82, TIER_Y[tier])), m);
      ring.computeLineDistances();
      this.group.add(ring);
      const el = document.createElement('div');
      el.className = 'label label-tier';
      el.textContent = name;
      const lbl = new CSS2DObject(el);
      const p = hexPoints(R * 0.82, TIER_Y[tier])[2];
      lbl.position.copy(p);
      lbl.center.set(1, 0.5);
      lbl.visible = false;
      this.group.add(lbl);
      this.tierLabels.push(lbl);
    }

    // Rack frames.
    const rackEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(RACK_SIZE.x, RACK_SIZE.y, RACK_SIZE.z));
    const rackHitGeo = new THREE.BoxGeometry(RACK_SIZE.x + 0.4, RACK_SIZE.y + 4, RACK_SIZE.z + 0.4);
    for (const rack of site.racks) {
      const m = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4 });
      this.rackMats.push(m);
      const frame = new THREE.LineSegments(rackEdges, m);
      frame.position.set(rack.x, RACK_SIZE.y / 2 - 0.5, rack.z);
      this.group.add(frame);
      const hit = new THREE.Mesh(rackHitGeo, hitMat);
      hit.position.set(rack.x, RACK_SIZE.y / 2 + 1, rack.z);
      hit.userData = { kind: 'rack', id: rack.id };
      this.group.add(hit);
      this.rackHits.push(hit);
      const el = document.createElement('div');
      el.className = 'label label-rack';
      el.textContent = rack.name.replace('Rack ', '');
      const lbl = new CSS2DObject(el);
      lbl.position.set(rack.x, -0.4, rack.z + RACK_SIZE.z / 2 + 1.2);
      lbl.visible = false;
      this.group.add(lbl);
      this.rackLabels.push(lbl);
    }

    this.hit = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 44, 6), hitMat);
    this.hit.position.y = 18;
    this.hit.rotation.y = Math.PI / 6;
    this.hit.userData = { kind: 'site', id: site.id };
    this.group.add(this.hit);

    this.labelEl = document.createElement('div');
    this.labelEl.className = 'label label-site';
    this.labelEl.dataset.siteId = site.id;
    this.label = new CSS2DObject(this.labelEl);
    this.label.position.set(0, TIER_Y.core + 30, 0);
    this.label.center.set(0.5, 1);
    this.group.add(this.label);
  }

  setHealth(h: Health, p: Palette, counts: { crit: number; warn: number; devices: number }) {
    this.health = h;
    const c = h === 'ok' ? p.accent : p.health[h];
    this.rim.material.color.copy(neon(c, 2));
    this.rimLow.material.color.copy(neon(c, 1.2));
    this.deckMat.color.set(p.accent);
    this.cone.material.uniforms.uColor.value.set(c);
    for (const m of this.tierMats) m.color.set(p.accent);
    for (const m of this.rackMats) m.color.copy(neon(p.accent, 1.1));
    const chips = [
      counts.crit ? `<span class="chip crit">${p.glyph.critical} ${counts.crit}</span>` : '',
      counts.warn ? `<span class="chip warn">${p.glyph.warning} ${counts.warn}</span>` : '',
      !counts.crit && !counts.warn ? `<span class="chip ok">${p.glyph.ok} OK</span>` : '',
    ].join('');
    this.labelEl.dataset.health = h;
    this.labelEl.innerHTML = `<div class="site-name"><span class="site-code">${esc(this.site.code.toUpperCase())}</span>${esc(this.site.name)}</div><div class="site-meta">${esc(this.site.region)} · ${counts.devices} devices ${chips}</div>`;
  }

  update(t: number, dt: number, idle: boolean, inside = false) {
    this.dim += (this.dimTarget - this.dim) * Math.min(1, dt / 0.12);
    const vis = (1 - this.dim * 0.7) * this.appear;
    const e = this.appear;
    this.group.scale.set(0.85 + 0.15 * e, e, 0.85 + 0.15 * e);
    this.group.visible = e > 0.001;
    const pulse = this.health === 'critical' && idle ? 0.75 + 0.25 * Math.sin(t * 6) : 1;
    this.rim.material.opacity = vis * pulse;
    this.rimLow.material.opacity = 0.35 * vis;
    this.platMat.opacity = 0.92 * vis;
    this.deckMat.opacity = 0.12 * vis;
    this.cone.material.uniforms.uOpacity.value = (this.health === 'ok' ? 0.08 : 0.14) * vis * (inside ? 0.15 : 1);
    for (const m of this.tierMats) m.opacity = 0.18 * vis;
    for (const m of this.rackMats) m.opacity = 0.4 * vis;
  }
}
