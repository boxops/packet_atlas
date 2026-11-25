/** Infinite-feeling holographic ground grid with distance fade and a slow radar sweep. */
import * as THREE from 'three';

export const GRID_Y = -40;

export function createGrid(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color('#00e5ff') },
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uSweep: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uCam;
      uniform float uTime;
      uniform float uSweep;
      varying vec3 vWorld;
      float gridLine(vec2 p, float w) {
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        return 1.0 - min(min(g.x, g.y) / w, 1.0);
      }
      void main() {
        vec2 p = vWorld.xz;
        float camH = max(uCam.y - vWorld.y, 1.0);
        float minor = gridLine(p / 10.0, 1.0) * 0.10 * smoothstep(700.0, 150.0, camH);
        float major = gridLine(p / 50.0, 1.2) * 0.28;
        float dist = length(p - uCam.xz);
        float fade = exp(-pow(dist * 0.0015, 2.0));
        // Slow radar sweep ring travelling outwards from the origin.
        float r = length(p);
        float sweep = uSweep * smoothstep(40.0, 0.0, abs(mod(r - uTime * 45.0, 900.0) - 450.0)) * 0.35;
        float a = (max(minor, major) * (1.0 + sweep * 2.0) + sweep * 0.08) * fade;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = GRID_Y;
  mesh.renderOrder = -1;
  return mesh;
}

/** Faint drifting dust motes that give the void some depth. */
export function createDust(count = 600): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 1400;
    pos[i * 3 + 1] = GRID_Y + Math.random() * 260;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 900;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 1.1, color: '#5fdcff', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  return new THREE.Points(geo, mat);
}
