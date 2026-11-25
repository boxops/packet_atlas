/** Smart camera: orbit controls plus eased fly-to transitions that the user can interrupt. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { easeInOutCubic } from '../core/util';
import type { CameraState } from '../core/prefs';

interface Tween {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  start: number;
  duration: number;
  ease: (t: number) => number;
  resolve: () => void;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private tween: Tween | null = null;
  /** Fires when the user grabs the camera (used to pause wallboard/incident auto-play). */
  onUserInput: (() => void) | null = null;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
    this.camera.position.set(0, 1600, 1500);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 1800;
    this.controls.zoomSpeed = 0.9;
    this.controls.rotateSpeed = 0.6;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', () => {
      if (this.tween) {
        const t = this.tween;
        this.tween = null;
        t.resolve();
      }
      this.onUserInput?.();
    });
  }

  get busy() {
    return this.tween !== null;
  }

  flyTo(pos: THREE.Vector3, target: THREE.Vector3, duration = 600, ease = easeInOutCubic): Promise<void> {
    if (this.tween) this.tween.resolve();
    return new Promise((resolve) => {
      if (duration <= 0) {
        this.camera.position.copy(pos);
        this.controls.target.copy(target);
        this.controls.update();
        this.tween = null;
        resolve();
        return;
      }
      this.tween = {
        fromPos: this.camera.position.clone(),
        fromTarget: this.controls.target.clone(),
        toPos: pos.clone(),
        toTarget: target.clone(),
        start: performance.now(),
        duration,
        ease,
        resolve,
      };
    });
  }

  /**
   * Frame a sphere. Keeps the current horizontal heading so moves feel continuous, sets the
   * elevation, and can bias the subject left to leave room for an anchored panel.
   */
  frame(center: THREE.Vector3, radius: number, opts: { elevationDeg?: number; duration?: number; biasLeft?: number; biasUp?: number; heading?: number } = {}) {
    const cam = this.camera;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const fov = Math.min(vfov, hfov);
    const dist = (radius / Math.sin(fov / 2)) * 1.05;
    const dir = cam.position.clone().sub(this.controls.target);
    let heading = opts.heading ?? Math.atan2(dir.x, dir.z);
    if (!Number.isFinite(heading)) heading = 0;
    const el = THREE.MathUtils.degToRad(opts.elevationDeg ?? 35);
    const offset = new THREE.Vector3(Math.sin(heading) * Math.cos(el), Math.sin(el), Math.cos(heading) * Math.cos(el)).multiplyScalar(dist);
    const target = center.clone();
    if (opts.biasLeft) {
      // Shift the look-at point right so the subject sits left of centre.
      const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      target.addScaledVector(right, radius * opts.biasLeft);
    }
    // Lowering the look-at point lifts the subject on screen (room for a bottom sheet).
    if (opts.biasUp) target.y -= radius * opts.biasUp;
    return this.flyTo(target.clone().add(offset), target, opts.duration ?? 600);
  }

  update() {
    const tw = this.tween;
    if (tw) {
      const k = Math.min(1, (performance.now() - tw.start) / tw.duration);
      const e = tw.ease(k);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (k >= 1) {
        this.tween = null;
        tw.resolve();
      }
    }
    this.controls.update();
  }

  getState(): CameraState {
    const p = this.camera.position;
    const t = this.controls.target;
    return { pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setState(s: CameraState, duration = 600) {
    return this.flyTo(new THREE.Vector3(...s.pos), new THREE.Vector3(...s.target), duration);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
