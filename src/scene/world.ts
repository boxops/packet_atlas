/**
 * The 3D world: renderer + post-processing, site islands, devices, links, alarm beacons,
 * selection reticle, semantic zoom levels (Global > Site > Rack > Device) and label LOD.
 */
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Model } from '../data/model';
import type { Alarm, Selection, ViewTarget } from '../data/types';
import { SITE_RADIUS, TIER_Y } from '../data/mock';
import { palette, type Palette } from '../core/palette';
import { Emitter, easeOutCubic, esc } from '../core/util';
import type { PathResult } from '../core/path';
import { CameraRig } from './camera';
import { createDust, createGrid } from './grid';
import { DeviceVisual, neon } from './devices';
import { SiteVisual, RACK_SIZE } from './sites';
import { LinkLayer } from './links';
import { resolveFx, type Fx } from './fx';
import { reticleTexture } from './textures';

export interface Highlight {
  devices: Set<string>;
  links: Set<string>;
}

type WorldEvents = {
  view: ViewTarget;
  frame: { t: number; dt: number };
  'perf-low': { fps: number };
};

class Beacon {
  readonly group = new THREE.Group();
  readonly label: CSS2DObject;
  private mat: THREE.ShaderMaterial;
  constructor(
    readonly alarm: Alarm,
    pos: THREE.Vector3,
    p: Palette,
    title: string,
  ) {
    const color = alarm.severity === 'critical' ? p.health.critical : p.health.warning;
    const h = alarm.severity === 'critical' ? 70 : 48;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: neon(color, 2) }, uOpacity: { value: 0.6 }, uTime: { value: 0 } },
      vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying float vY;
        void main(){ float band = 0.6 + 0.4 * smoothstep(0.0, 0.08, abs(fract(vY * 3.0 - uTime * 0.8) - 0.5));
        float a = pow(1.0 - vY, 1.6) * uOpacity * band; gl_FragColor = vec4(uColor * a, a); }`,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.8, h, 12, 1, true), this.mat);
    beam.position.y = h / 2 + 1.5;
    this.group.add(beam);
    this.group.position.copy(pos);
    const el = document.createElement('div');
    el.className = `label label-alarm sev-${alarm.severity}`;
    el.innerHTML = `<span class="glyph">${alarm.severity === 'critical' ? p.glyph.critical : p.glyph.warning}</span>${esc(title)}`;
    el.dataset.alarmId = alarm.id;
    this.label = new CSS2DObject(el);
    this.label.position.y = h + 3;
    this.label.center.set(0.5, 1);
    this.group.add(this.label);
  }
  update(t: number, vis: number, idle: boolean) {
    this.mat.uniforms.uTime.value = idle ? t : 0;
    this.mat.uniforms.uOpacity.value = vis * (idle ? 0.5 + 0.2 * Math.sin(t * 3) : 0.6);
  }
  dispose() {
    this.label.element.remove();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.mat.dispose();
  }
}

export class World extends Emitter<WorldEvents> {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  readonly labels: CSS2DRenderer;
  readonly devices = new Map<string, DeviceVisual>();
  readonly sites = new Map<string, SiteVisual>();
  links!: LinkLayer;
  view: ViewTarget = { level: 'global' };
  selection: Selection | null = null;
  highlight: Highlight | null = null;
  path: PathResult | null = null;
  fx: Fx = resolveFx();
  pal: Palette = palette();

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private bokeh: BokehPass;
  private grid = createGrid();
  private dust = createDust();
  private reticle: THREE.Sprite;
  private hover: Selection | null = null;
  private beacons: Beacon[] = [];
  private pickables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  private lastFrame = performance.now();
  private t = 0;
  private frameTimes: number[] = [];
  private lastPerfCheck = 0;
  private dofAperture = 0;
  private built = false;

  constructor(
    private container: HTMLElement,
    private model: Model,
  ) {
    super();
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.fx.pixelRatio);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(this.pal.bg);
    this.scene.fog = new THREE.FogExp2(this.pal.bg, 0.00055);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.rig = new CameraRig(canvas);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-layer';
    container.appendChild(this.labels.domElement);

    this.scene.add(new THREE.HemisphereLight('#3d6bff', '#020409', 0.7));
    const key = new THREE.DirectionalLight('#a6ecff', 1.6);
    key.position.set(200, 400, 300);
    this.scene.add(key);
    this.scene.add(this.grid, this.dust);

    this.reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.reticle.visible = false;
    this.reticle.renderOrder = 10;
    (this.reticle.material as THREE.SpriteMaterial).color.copy(neon(this.pal.magenta, 1.25));
    (this.reticle.material as THREE.SpriteMaterial).opacity = 0.85;
    this.scene.add(this.reticle);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.bokeh = new BokehPass(this.scene, this.rig.camera, { focus: 50, aperture: 0, maxblur: 0.006 });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applyFx();
  }

  // ── construction ──

  devicePos(id: string): THREE.Vector3 {
    const d = this.model.devices.get(id)!;
    const s = this.model.sites.get(d.siteId)!;
    return new THREE.Vector3(s.x + d.x, d.y, s.z + d.z);
  }

  build() {
    for (const s of this.model.topo.sites) {
      const sv = new SiteVisual(s);
      this.sites.set(s.id, sv);
      this.scene.add(sv.group);
      this.pickables.push(sv.hit, ...sv.rackHits);
    }
    for (const d of this.model.topo.devices) {
      const dv = new DeviceVisual(d, this.devicePos(d.id));
      this.devices.set(d.id, dv);
      this.scene.add(dv.group);
      this.pickables.push(dv.hit);
    }
    this.links = new LinkLayer(this.model, (id) => this.devicePos(id));
    this.scene.add(this.links.group);
    this.pickables.push(...this.links.hits);
    this.resize();
    this.built = true;
    this.refreshHealth();
    this.updateLabels();
  }

  /** Stream sites in one by one (each eases in over ~500 ms) instead of a blocking load. */
  async reveal(stagger = 110) {
    const order = [...this.sites.values()];
    for (const sv of order) {
      const start = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / 500);
        const e = easeOutCubic(k);
        sv.appear = e;
        for (const dv of this.devices.values()) if (dv.device.siteId === sv.site.id) dv.appear = e;
        this.syncLinkAppear();
        if (k < 1) requestAnimationFrame(step);
        else this.updateLabels();
      };
      requestAnimationFrame(step);
      await new Promise((r) => setTimeout(r, this.fx.idle ? stagger : 0));
    }
  }

  private syncLinkAppear() {
    for (const v of this.links.visuals.values()) {
      const a = this.devices.get(v.link.a.deviceId)!.appear;
      const b = this.devices.get(v.link.b.deviceId)!.appear;
      v.appear = Math.min(a, b);
    }
  }

  // ── health / palette ──

  refreshHealth() {
    if (!this.built) return;
    const p = this.pal;
    for (const dv of this.devices.values()) {
      const h = this.model.deviceHealth(dv.device.id);
      if (h !== dv.health || !dv.label.element.innerHTML) dv.setHealth(h, p);
    }
    for (const sv of this.sites.values()) {
      const alarms = this.model.topo.alarms.filter((a) => a.siteId === sv.site.id);
      sv.setHealth(this.model.siteHealth(sv.site.id), p, {
        crit: alarms.filter((a) => a.severity === 'critical').length,
        warn: alarms.filter((a) => a.severity !== 'critical').length,
        devices: this.model.devicesInSite(sv.site.id).length,
      });
    }
    this.links.refresh(p);
    this.syncBeacons();
  }

  applyPalette() {
    this.pal = palette();
    this.grid.material.uniforms.uColor.value.set(this.pal.accent).multiplyScalar(this.fx.bloom ? 1 : 1.8);
    (this.dust.material as THREE.PointsMaterial).color.set(this.pal.accent);
    (this.reticle.material as THREE.SpriteMaterial).color.copy(neon(this.pal.magenta, 1.25));
    for (const dv of this.devices.values()) dv.setHealth(dv.health, this.pal);
    for (const b of this.beacons) b.dispose();
    this.beacons = [];
    this.refreshHealth();
  }

  private beaconKey = '';
  private syncBeacons() {
    const alarms = this.model.sortedAlarms();
    const key = alarms.map((a) => a.id).join(',') + this.pal.health.critical;
    if (key === this.beaconKey) return;
    this.beaconKey = key;
    for (const b of this.beacons) {
      this.scene.remove(b.group);
      b.dispose();
    }
    this.beacons = alarms.map((a) => {
      const pos = a.targetType === 'device' ? this.devicePos(a.targetId).add(new THREE.Vector3(0, this.devices.get(a.targetId)!.top, 0)) : this.links.midpoint(a.targetId);
      const target = a.targetType === 'device' ? a.targetId : this.model.viewLabel({ level: 'link', linkId: a.targetId });
      const b = new Beacon(a, pos, this.pal, target);
      this.scene.add(b.group);
      return b;
    });
    this.updateLabels();
  }

  // ── fx ──

  applyFx() {
    this.fx = resolveFx();
    this.renderer.setPixelRatio(this.fx.pixelRatio);
    this.bloom.enabled = this.fx.bloom;
    this.dust.visible = this.fx.dust;
    this.grid.material.uniforms.uSweep.value = this.fx.idle && this.fx.bloom ? 1 : 0;
    // Without bloom the grid loses its glow; lift it so the ground plane stays legible.
    this.grid.material.uniforms.uColor.value.set(this.pal.accent).multiplyScalar(this.fx.bloom ? 1 : 1.8);
    this.resize();
  }

  // ── navigation ──

  frameFor(v: ViewTarget): { center: THREE.Vector3; radius: number; elevation: number } {
    switch (v.level) {
      case 'global': {
        const ss = this.model.topo.sites;
        const c = new THREE.Vector3();
        for (const s of ss) c.add(new THREE.Vector3(s.x, 0, s.z));
        c.divideScalar(Math.max(1, ss.length));
        let r = 100;
        for (const s of ss) r = Math.max(r, Math.hypot(s.x - c.x, s.z - c.z) + SITE_RADIUS);
        c.y = 10;
        return { center: c, radius: r * 0.74, elevation: 46 };
      }
      case 'site': {
        const s = this.model.sites.get(v.siteId)!;
        return { center: new THREE.Vector3(s.x, TIER_Y.distribution * 0.7, s.z), radius: SITE_RADIUS + 4, elevation: 30 };
      }
      case 'rack': {
        const s = this.model.sites.get(v.siteId)!;
        const r = this.model.racks.get(v.rackId)!;
        return { center: new THREE.Vector3(s.x + r.x, 6.5, s.z + r.z), radius: 12, elevation: 16 };
      }
      case 'device': {
        const dv = this.devices.get(v.deviceId)!;
        return { center: this.devicePos(v.deviceId), radius: 10 * dv.device.scale, elevation: 18 };
      }
      case 'link': {
        const lv = this.links.visuals.get(v.linkId)!;
        return { center: this.links.midpoint(v.linkId), radius: Math.max(18, lv.length * 0.55), elevation: lv.link.kind === 'wan' ? 40 : 28 };
      }
    }
  }

  goTo(v: ViewTarget, opts: { duration?: number; biasLeft?: number; biasUp?: number } = {}) {
    this.view = v;
    const f = this.frameFor(v);
    const p = this.rig.frame(f.center, f.radius, { elevationDeg: f.elevation, duration: opts.duration ?? this.fx.camMs, biasLeft: opts.biasLeft, biasUp: opts.biasUp });
    this.updateLabels();
    this.emit('view', v);
    return p;
  }

  /** Cinematic opening: descend from high orbit onto the global overview. */
  introFlyIn() {
    const f = this.frameFor({ level: 'global' });
    this.rig.camera.position.set(f.center.x + 160, 1500, f.center.z + 1500);
    this.rig.controls.target.copy(f.center);
    return this.rig.frame(f.center, f.radius, { elevationDeg: f.elevation, duration: this.fx.idle ? 2200 : 0, heading: 0.18 });
  }

  /** Focus the camera on a selection without changing level (single click). */
  focusOn(sel: Selection) {
    const target = this.worldPosOf(sel);
    const cam = this.rig.camera.position.clone();
    const delta = target.clone().sub(this.rig.controls.target);
    // Gentle re-centre: move target and camera together, and pull in a little if far away.
    const dist = cam.distanceTo(target);
    const want = sel.kind === 'site' ? 170 : sel.kind === 'rack' ? 60 : sel.kind === 'link' ? Math.max(40, this.links.visuals.get(sel.id)!.length * 0.8) : 45;
    const newPos = cam.clone().add(delta);
    if (dist > want * 2.2) newPos.lerp(target, 1 - (want * 2.2) / dist);
    return this.rig.flyTo(newPos, target, Math.min(450, this.fx.camMs));
  }

  worldPosOf(sel: Selection): THREE.Vector3 {
    switch (sel.kind) {
      case 'device':
        return this.devicePos(sel.id);
      case 'site': {
        const s = this.model.sites.get(sel.id)!;
        return new THREE.Vector3(s.x, TIER_Y.distribution, s.z);
      }
      case 'rack': {
        const r = this.model.racks.get(sel.id)!;
        const s = this.model.sites.get(r.siteId)!;
        return new THREE.Vector3(s.x + r.x, RACK_SIZE.y / 2, s.z + r.z);
      }
      case 'link':
        return this.links.midpoint(sel.id);
    }
  }

  /** Default view target for a selection (used for double-click / Enter: zoom one level in). */
  viewFor(sel: Selection): ViewTarget {
    switch (sel.kind) {
      case 'site':
        return { level: 'site', siteId: sel.id };
      case 'rack':
        return { level: 'rack', siteId: this.model.racks.get(sel.id)!.siteId, rackId: sel.id };
      case 'device':
        return { level: 'device', deviceId: sel.id };
      case 'link':
        return { level: 'link', linkId: sel.id };
    }
  }

  project(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.rig.camera);
    const r = this.container.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * r.width + r.left, y: ((1 - p.y) / 2) * r.height + r.top, visible: p.z < 1 && p.z > -1 };
  }

  // ── selection / hover / highlight ──

  select(sel: Selection | null) {
    this.selection = sel;
    for (const dv of this.devices.values()) dv.selected = sel?.kind === 'device' && sel.id === dv.device.id;
    this.updateLabels();
  }

  setHover(sel: Selection | null) {
    if (this.hover?.kind === 'device') {
      const dv = this.devices.get(this.hover.id);
      if (dv) dv.hovered = false;
    }
    this.hover = sel;
    if (sel?.kind === 'device') this.devices.get(sel.id)!.hovered = true;
  }

  setHighlight(h: Highlight | null) {
    this.highlight = h;
    const siteHas = new Set<string>();
    if (h) {
      for (const id of h.devices) siteHas.add(this.model.devices.get(id)!.siteId);
      for (const id of h.links) for (const s of this.model.linkSites(this.model.links.get(id)!)) siteHas.add(s);
    }
    for (const dv of this.devices.values()) dv.dimTarget = h && !h.devices.has(dv.device.id) ? 1 : 0;
    for (const v of this.links.visuals.values()) v.dimTarget = h && !h.links.has(v.link.id) ? 1 : 0;
    for (const sv of this.sites.values()) sv.dimTarget = h && !siteHas.has(sv.site.id) ? 1 : 0;
    this.updateLabels();
  }

  setPath(p: PathResult | null) {
    this.path = p;
    for (const v of this.links.visuals.values()) {
      v.onPath = !!p?.ok && p.linkIds.includes(v.link.id);
      v.reversed = v.onPath && !!p?.reversed[v.link.id];
    }
    this.links.refresh(this.pal);
    if (p?.ok) this.setHighlight({ devices: new Set(p.hops.map((h) => h.device.id)), links: new Set(p.linkIds) });
    else this.setHighlight(null);
  }

  /** Bounding sphere for a set of devices/links, used to frame query results. */
  frameSet(deviceIds: string[], linkIds: string[], opts: { biasLeft?: number } = {}) {
    const pts: THREE.Vector3[] = [];
    for (const id of deviceIds) pts.push(this.devicePos(id));
    for (const id of linkIds) {
      const v = this.links.visuals.get(id)!;
      pts.push(v.p0, v.p2, this.links.midpoint(id));
    }
    if (!pts.length) return Promise.resolve();
    const sphere = new THREE.Sphere().setFromPoints(pts);
    return this.rig.frame(sphere.center, Math.max(30, sphere.radius * 1.15), { elevationDeg: sphere.radius > 120 ? 50 : 30, duration: this.fx.camMs, ...opts });
  }

  // ── picking ──

  pick(clientX: number, clientY: number): Selection | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false).filter((h) => {
      const k = h.object.userData.kind;
      if (k === 'device') return this.devices.get(h.object.userData.id)!.appear > 0.5;
      return true;
    });
    if (!hits.length) return null;
    const near = hits[0].distance + 90;
    // Semantic picking: from orbit you mean the site (or a WAN arc); inside a site you mean
    // the device, then its links, then the rack.
    const global = this.view.level === 'global';
    const rank = (o: THREE.Object3D) => {
      const k = o.userData.kind as string;
      if (global) {
        if (k === 'site') return 0;
        if (k === 'link') return this.model.links.get(o.userData.id)!.kind === 'wan' ? 1 : 3;
        return k === 'device' ? 2 : 9;
      }
      return ({ device: 0, link: 1, rack: 2, site: 3 } as Record<string, number>)[k] ?? 9;
    };
    const best = hits
      .filter((h) => h.distance <= near)
      .filter((h) => !(h.object.userData.kind === 'rack' && global))
      .sort((a, b) => rank(a.object) - rank(b.object) || a.distance - b.distance)[0];
    if (!best) {
      // Only racks were hit at global level: select their site instead.
      const rack = this.model.racks.get(hits[0].object.userData.id);
      return rack ? { kind: 'site', id: rack.siteId } : null;
    }
    return { kind: best.object.userData.kind, id: best.object.userData.id } as Selection;
  }

  /** Site the camera is currently inside (null at global level or on a WAN link). */
  currentSiteId(): string | null {
    const v = this.view;
    if (v.level === 'site' || v.level === 'rack') return v.siteId;
    if (v.level === 'device') return this.model.devices.get(v.deviceId)!.siteId;
    if (v.level === 'link') {
      const s = this.model.linkSites(this.model.links.get(v.linkId)!);
      return s.length === 1 ? s[0] : null;
    }
    return null;
  }

  // ── labels (level of detail) ──

  updateLabels() {
    if (!this.built) return;
    const v = this.view;
    const siteId = v.level === 'site' || v.level === 'rack' ? v.siteId : v.level === 'device' ? this.model.devices.get(v.deviceId)!.siteId : null;
    const rackId = v.level === 'rack' ? v.rackId : v.level === 'device' ? this.model.devices.get(v.deviceId)!.rackId : undefined;
    const neighbourIds = v.level === 'device' ? new Set(this.model.neighbours(v.deviceId).map((n) => n.device.id)) : null;
    const hl = this.highlight;

    for (const sv of this.sites.values()) {
      const mine = sv.site.id === siteId;
      sv.label.visible = sv.appear > 0.5 && !mine;
      sv.labelEl.classList.toggle('compact', v.level !== 'global' && !mine);
      for (const l of sv.tierLabels) l.visible = mine && v.level === 'site';
      for (const l of sv.rackLabels) l.visible = mine && (v.level === 'site' || v.level === 'rack');
    }
    for (const dv of this.devices.values()) {
      const d = dv.device;
      let show = false;
      if (hl) show = hl.devices.has(d.id) && (hl.devices.size <= 40 || d.tier !== 'endpoint');
      else if (d.siteId === siteId) {
        if (v.level === 'site') show = d.tier !== 'endpoint' || dv.health !== 'ok';
        else if (v.level === 'rack') show = d.rackId === rackId;
        else if (v.level === 'device') show = d.id === v.deviceId || !!neighbourIds?.has(d.id) || (!!rackId && d.rackId === rackId);
      }
      if (this.selection?.kind === 'device' && this.selection.id === d.id) show = true;
      dv.label.visible = show && dv.appear > 0.5;
    }
    for (const b of this.beacons) b.label.visible = v.level === 'site' && b.alarm.siteId === siteId;
  }

  // ── frame loop ──

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    requestAnimationFrame(loop);
  }

  private frame() {
    const nowMs = performance.now();
    const dt = Math.min(0.1, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    this.t += dt;
    const t = this.t;
    this.rig.update();
    const cam = this.rig.camera;
    this.grid.material.uniforms.uCam.value.copy(cam.position);
    this.grid.material.uniforms.uTime.value = this.fx.idle ? t : 0;
    if (this.fx.dust && this.fx.idle) this.dust.rotation.y = t * 0.004;

    if (this.built) {
      const camPos = cam.position;
      for (const sv of this.sites.values()) {
        const near = Math.hypot(camPos.x - sv.site.x, camPos.z - sv.site.z) < SITE_RADIUS * 4 && camPos.y < 220;
        sv.update(t, dt, this.fx.idle, near);
      }
      for (const dv of this.devices.values()) dv.update(t, dt, this.fx);
      this.links.update(t, dt, this.fx, this.pal);
      // Beacons are for spotting problems from afar; fade them out as the camera closes in.
      for (const b of this.beacons) b.update(t, THREE.MathUtils.smoothstep(cam.position.distanceTo(b.group.position), 50, 260), this.fx.idle);
      this.updateReticle(t);
    }

    // Depth of field only when inspecting a single device.
    const wantDof = this.fx.dof && this.view.level === 'device';
    this.dofAperture += ((wantDof ? 0.00012 : 0) - this.dofAperture) * Math.min(1, dt / 0.15);
    this.bokeh.enabled = this.dofAperture > 0.000005;
    if (this.bokeh.enabled && this.view.level === 'device') {
      const u = this.bokeh.uniforms as Record<string, THREE.IUniform>;
      u.focus.value = cam.position.distanceTo(this.devicePos(this.view.deviceId));
      u.aperture.value = this.dofAperture;
    }

    if (this.fx.bloom || this.bokeh.enabled) this.composer.render(dt);
    else this.renderer.render(this.scene, cam);
    this.labels.render(this.scene, cam);
    this.emit('frame', { t, dt });
    this.trackPerf(dt);
  }

  private updateReticle(t: number) {
    const sel = this.selection;
    const r = this.reticle;
    const v = this.view;
    const isView = (sel?.kind === 'site' && v.level !== 'global') || (sel?.kind === 'rack' && (v.level === 'rack' || v.level === 'device'));
    if (!sel || isView) {
      r.visible = false;
      return;
    }
    r.visible = true;
    r.position.copy(this.worldPosOf(sel));
    const size = sel.kind === 'site' ? SITE_RADIUS * 2.3 : sel.kind === 'rack' ? 14 : sel.kind === 'link' ? 6 : (this.devices.get(sel.id)!.device.role === 'server' ? 5 : 6.5) * this.devices.get(sel.id)!.device.scale;
    const breathe = this.fx.idle ? 1 + Math.sin(t * 3) * 0.04 : 1;
    r.scale.setScalar(size * breathe);
    (r.material as THREE.SpriteMaterial).rotation = this.fx.idle ? t * 0.25 : 0;
  }

  private trackPerf(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    const now = performance.now();
    if (now - this.lastPerfCheck < 4000 || this.frameTimes.length < 200 || document.hidden) return;
    this.lastPerfCheck = now;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const fps = 1 / avg;
    if (fps < 28) this.emit('perf-low', { fps });
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const br = this.fx.bloomHalfRes ? 0.5 : 1;
    this.bloom.resolution.set(w * br, h * br);
    this.labels.setSize(w, h);
    this.rig.resize(w, h);
    this.links?.setScale(h * this.renderer.getPixelRatio(), this.rig.camera.fov);
  }
}
