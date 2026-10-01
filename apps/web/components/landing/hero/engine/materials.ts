// Brushed-metal look (LANDING-SPEC §5.3–5.4): a procedural brushed roughness
// map and a dark studio environment with one cool platinum softbox, so top faces
// read lightest. Violet appears only as a faint panel in the shadow hemisphere.
import * as THREE from 'three';
import { palette, type ScenePalette } from './palette';
import { rng } from './springs';

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  return [c, g];
}

/**
 * Brushed roughness: long, low-contrast horizontal strokes (about half the old
 * contrast, the same mean roughness) and a 1px blur, so at
 * DPR 1 it reads as brushed aluminium, not as scanlines. Mipmapped, with the
 * GPU's full anisotropy for the grazing faces.
 */
export function brushedTexture(maxAnisotropy = 8, size = 512): THREE.CanvasTexture {
  const [c, g] = canvas2d(size, size);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, size, size);
  const r = rng(7);
  for (let i = 0; i < 2200; i++) {
    const y = r() * size;
    const x = r() * size - size * 0.4;
    const len = size * (0.5 + r() * 1.1);
    const v = 106 + Math.floor(r() * 44);
    g.strokeStyle = `rgba(${v},${v},${v},${0.18 + r() * 0.22})`;
    g.lineWidth = 0.6 + r() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y + (r() - 0.5) * 0.8);
    g.stroke();
  }
  // soften: a 1px blur pass (drawn back through the canvas filter)
  const [c2, g2] = canvas2d(size, size);
  g2.filter = 'blur(1px)';
  g2.drawImage(c, 0, 0);
  const tex = new THREE.CanvasTexture(c2);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/** PMREM of a graded dome with a top softbox and bevel strips; baked once per theme. */
export function studioEnvironment(renderer: THREE.WebGLRenderer, p: ScenePalette = palette()): THREE.WebGLRenderTarget {
  const env = new THREE.Scene();
  const domeGeo = new THREE.SphereGeometry(20, 48, 24);
  const cols: number[] = [];
  const top = new THREE.Color(p.env.domeTop);
  // lifted from near-black: faces turned to the lower dome (the right and front
  // faces of a tilted cube) reflect graphite, never read as holes
  const mid = new THREE.Color(p.env.domeMid);
  const low = new THREE.Color(p.env.domeLow);
  const pos = domeGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 20;
    const c = y > 0 ? mid.clone().lerp(top, Math.pow(y, 0.8)) : mid.clone().lerp(low, Math.min(1, -y * 1.4));
    cols.push(c.r, c.g, c.b);
  }
  domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  env.add(new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const O = new THREE.Vector3();
  const panel = (w: number, h: number, [color, strength]: [number, number], at: THREE.Vector3) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide }),
    );
    m.position.copy(at);
    m.lookAt(O);
    env.add(m);
  };
  // top softbox (cool platinum), up and behind: top faces read lightest
  panel(18, 10, p.env.softbox, new THREE.Vector3(0, 13, -6));
  // lower-left graphite fill: left faces mid-tone; lower-right barely lit: right faces dark
  panel(12, 8, p.env.fillL, new THREE.Vector3(-12, -7, -6));
  panel(12, 8, p.env.fillR, new THREE.Vector3(12, -7, -6));
  // thin vertical strips: crisp highlights running along bevels
  panel(0.9, 16, p.env.stripL, new THREE.Vector3(-13, 3, -3));
  panel(0.6, 14, p.env.stripR, new THREE.Vector3(13, 2, -8));
  // the only violet: a deep, dim glow straight below, in the shadow hemisphere
  // (iso front faces reflect almost straight down: a graphite floor, so they never read as holes)
  panel(20, 8, p.env.floor, new THREE.Vector3(0, -13, 0));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.035);
  pm.dispose();
  env.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return rt;
}

export function metalMaterial(rough: THREE.Texture, p: ScenePalette = palette()): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: p.metal.color,
    metalness: p.metal.metalness,
    // lower: the softbox strips draw crisp specular streaks along the bevels (machined, not clay)
    roughness: p.metal.roughness,
    roughnessMap: rough,
    anisotropy: 0.55,
    anisotropyRotation: 0,
    clearcoat: 0.25,
    // never under .35: a sharper coat sparkles along sub-pixel bevels at DPR 1
    clearcoatRoughness: 0.5,
    envMapIntensity: p.metal.envIntensity,
  });
}

/** Re-tints an existing metal material for a palette (live theme switch). */
export function tintMetal(m: THREE.MeshPhysicalMaterial, p: ScenePalette): void {
  m.color.set(p.metal.color);
  m.metalness = p.metal.metalness;
  m.roughness = p.metal.roughness;
  m.envMapIntensity = p.metal.envIntensity;
}

/** Radial mask for the contact shade: centre .45 → 0 (the shader reads its alpha). */
export function shadeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas2d(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.45)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.2)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * A version slice's face: the volume's own voxel grid (cols × rows), in the
 * cube's tones with thin grout, so a slice keeps the cube's identity.
 */
export function faceTexture(cols: number, rows: number, seed: number, p: ScenePalette = palette()): THREE.CanvasTexture {
  const px = 64;
  const [c, g] = canvas2d(cols * px, rows * px);
  g.fillStyle = p.slice.grout ?? p.slice.base;
  g.fillRect(0, 0, c.width, c.height);
  const r = rng(seed);
  const grout = Math.max(3, Math.round(px * 0.06));
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const v = Math.round(p.slice.tone + (r() - 0.5) * 16 + (rows - y) * 3);
      const grd = g.createLinearGradient(0, y * px, 0, (y + 1) * px);
      grd.addColorStop(0, `rgb(${v + 22},${v + 25},${v + 31})`);
      grd.addColorStop(1, `rgb(${v - 18},${v - 16},${v - 11})`);
      g.fillStyle = grd;
      g.fillRect(x * px + grout / 2, y * px + grout / 2, px - grout, px - grout);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
