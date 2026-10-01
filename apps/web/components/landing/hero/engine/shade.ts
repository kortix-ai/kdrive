// Contact shades (LANDING-SPEC §5.3): one soft radial shadow under each volume,
// drawn as a single instanced batch. The canvas is transparent over the CSS
// atmosphere, so a shade writes black with alpha (premultiplied), darkening
// whatever is behind it; distance fades it like the fog.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aOpacity;
varying vec2 vUv;
varying float vAlpha;
uniform float uFogNear;
uniform float uFogFar;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  float fog = smoothstep(uFogNear, uFogFar, -mv.z);
  // half the fog: the shade grounds the far cubes too
  vAlpha = aOpacity * (1.0 - 0.5 * fog);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, vUv).a * vAlpha;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Shades {
  readonly mesh: THREE.InstancedMesh;
  private readonly opacity: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;

  constructor(count: number, map: THREE.Texture) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOpacity', this.opacity);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uFogNear: { value: 12 }, uFogFar: { value: 27 } },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  setFog(near: number, far: number): void {
    this.material.uniforms.uFogNear.value = near;
    this.material.uniforms.uFogFar.value = far;
  }

  /**
   * Place shade i under a volume centre (field space): scale 1.7 × size,
   * .85 × size below and .2 behind; stretched along the drag velocity (up to 1.4×).
   */
  set(i: number, centre: THREE.Vector3, size: number, lift: number, vx: number, vy: number, visible: boolean): void {
    const ax = Math.min(Math.abs(vx) / 8, 1) * 0.4;
    const ay = Math.min(Math.abs(vy) / 8, 1) * 0.4;
    _p.set(centre.x, centre.y - size * 0.85, centre.z - 0.2);
    _s.set(size * 1.7 * (1 + ax), size * 1.7 * 0.55 * (1 + ay), 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    const op = visible ? 0.55 * (1 - Math.min(Math.max(lift * 1.4, 0), 0.8)) : 0;
    this.opacity.setX(i, op);
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
