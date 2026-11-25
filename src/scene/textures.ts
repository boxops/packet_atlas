/** Procedurally generated textures (no image downloads: keeps first load fast). */
import * as THREE from 'three';

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, w = size): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glow: THREE.Texture | null = null;
/** Soft radial glow used for halos and highlight sprites. */
export function glowTexture(): THREE.Texture {
  return (glow ??= canvasTexture(128, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }));
}

let reticle: THREE.Texture | null = null;
/** HUD-style corner brackets for the selection reticle. */
export function reticleTexture(): THREE.Texture {
  return (reticle ??= canvasTexture(256, (g, s) => {
    g.strokeStyle = '#fff';
    g.lineWidth = 6;
    g.lineCap = 'square';
    const m = 18;
    const l = 56;
    for (const [x, y, dx, dy] of [
      [m, m, 1, 1],
      [s - m, m, -1, 1],
      [m, s - m, 1, -1],
      [s - m, s - m, -1, -1],
    ]) {
      g.beginPath();
      g.moveTo(x, y + dy * l);
      g.lineTo(x, y);
      g.lineTo(x + dx * l, y);
      g.stroke();
    }
    g.lineWidth = 2;
    g.globalAlpha = 0.5;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
    g.setLineDash([6, 10]);
    g.stroke();
  }));
}

let deck: THREE.Texture | null = null;
/** Fine grid printed on top of each site island. */
export function deckTexture(): THREE.Texture {
  return (deck ??= (() => {
    const t = canvasTexture(512, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1;
      const step = s / 32;
      for (let i = 0; i <= 32; i++) {
        g.globalAlpha = i % 4 === 0 ? 0.9 : 0.35;
        g.beginPath();
        g.moveTo(i * step, 0);
        g.lineTo(i * step, s);
        g.moveTo(0, i * step);
        g.lineTo(s, i * step);
        g.stroke();
      }
    });
    t.anisotropy = 4;
    return t;
  })());
}

let ports: THREE.Texture | null = null;
/** Port strip on the front of switches. */
export function portTexture(): THREE.Texture {
  return (ports ??= canvasTexture(
    32,
    (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, 256, 32);
      for (let i = 0; i < 24; i++) {
        g.fillStyle = i % 7 === 3 ? 'rgba(255,255,255,0.35)' : '#fff';
        g.fillRect(4 + i * 10.5, 9, 7, 6);
        g.fillRect(4 + i * 10.5, 18, 7, 6);
      }
    },
    256,
  ));
}
