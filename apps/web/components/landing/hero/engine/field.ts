// The hero field (LANDING-SPEC §5.3–5.8): renderer, scene, lights, layout
// switching, exclusion, the loop and its pauses. No React; the scene client
// mounts it and calls dispose() on unmount.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { fitHomes, measureZones, type Zones } from './exclusion';
import { Labels } from './labels';
import { pickLayout } from './layout';
import { brushedTexture, metalMaterial, shadeTexture, studioEnvironment } from './materials';
import { Rig } from './rig';
import { Stage, type Shared } from './stage';
import { Interaction } from './interaction';
import { DprGovernor, Loop } from './loop';
import { installProbe } from './probe';
import { clamp } from './springs';

export interface FieldOptions {
  hero: HTMLElement;
  /** The engine creates its own canvas here (a fresh context per mount). */
  canvasHost: HTMLElement;
  layer: HTMLElement;
  glow: HTMLElement | null;
  copyEls: () => Element[];
  reduced: boolean;
  dev: boolean;
  onReady(): void;
  onFan(open: boolean): void;
}

export interface FieldHandle {
  /** Keyboard path: toggle the fan on the first volume (Studio). */
  toggleFirst(): void;
  dispose(): void;
}

export function createField(o: FieldOptions): FieldHandle {
  const mobileDevice = window.matchMedia('(pointer: coarse)').matches;
  const dprCap = mobileDevice ? 2 : 1.75;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  // throws when WebGL is unavailable; the scene client then keeps the poster
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: dpr < 2, powerPreference: 'default' });
  o.canvasHost.appendChild(canvas);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const envRT = studioEnvironment(renderer);
  scene.environment = envRT.texture;
  const fog = new THREE.Fog(0x0a0a0b, 12, 27);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  const field = new THREE.Group();
  scene.add(field);
  // a neutral ground: a violet one gave the cubes a periwinkle cast
  scene.add(new THREE.HemisphereLight(0xcfd6e4, 0x16161a, 0.35));
  const key = new THREE.DirectionalLight(0xe8eaee, 0.75);
  key.position.set(-3, 8, 6);
  scene.add(key);
  // a low, dim fill from the right: right faces read as dark graphite, not as holes
  // (dimmer than the key's side: a cube's three faces read as three distinct values)
  const fill = new THREE.DirectionalLight(0xc8ccd4, 0.28);
  fill.position.set(7, -3, 5);
  scene.add(fill);
  const rig = new Rig(camera, o.glow);
  scene.add(rig.light);

  const rough = brushedTexture(renderer.capabilities.getMaxAnisotropy());
  const shared: Shared = {
    voxelGeo: new RoundedBoxGeometry(1, 1, 1, 2, 0.06),
    coreGeo: new THREE.BoxGeometry(1, 1, 1),
    metal: metalMaterial(rough),
    core: new THREE.MeshBasicMaterial({ color: 0x09090b }),
    shadeTex: shadeTexture(),
  };
  const labels = new Labels(o.layer, 6);

  let w = 1;
  let h = 1;
  let zones: Zones = measureZones(o.hero, [], 64);
  let stage: Stage | null = null;
  let disposed = false;

  const ix = new Interaction({
    hero: o.hero,
    canvas,
    camera,
    field,
    rig,
    labels,
    reduced: o.reduced,
    stage: () => stage!,
    zones: () => zones,
    size: () => [w, h],
    wake: () => loop.wake(),
    onFan: o.onFan,
  });

  /** (Re)build the stage when the layout changes (aspect 0.9, with hysteresis). */
  function build(): boolean {
    const layout = pickLayout(w, w / h, stage?.layout ?? null);
    if (stage && stage.layout === layout) return false;
    ix.reset();
    stage?.dispose();
    stage = new Stage(layout, field, shared, o.reduced);
    camera.fov = layout.fov;
    // the small phone cubes sit further off: a touch more light keeps their tops reading lightest
    renderer.toneMappingExposure = layout.mobile ? 1.15 : 1;
    shared.metal.envMapIntensity = layout.mobile ? 1.35 : 1.15;
    return true;
  }

  /** Camera distance, fog and the exclusion pass, from the live size. Never in the loop. */
  function fit(): void {
    if (!stage) return;
    const L = stage.layout;
    camera.aspect = w / h;
    rig.camZ = Math.max(L.camZ, L.halfW / (Math.tan((L.fov * Math.PI) / 360) * camera.aspect));
    camera.updateProjectionMatrix();
    fog.near = rig.camZ - 2;
    // the far volumes (Archive, the ghost) stay legible: their shells read at rest
    fog.far = rig.camZ + 18;
    stage.shades.setFog(fog.near, fog.far);
    const navH = parseFloat(getComputedStyle(o.hero).getPropertyValue('--kd-nav-h')) || 64;
    zones = measureZones(o.hero, o.copyEls(), navH);
    rig.rest(field);
    for (const v of stage.volumes) v.rest();
    fitHomes(stage.volumes, zones, camera, L.pushY, o.dev);
    ix.measure();
  }

  function resize(): void {
    const r = o.hero.getBoundingClientRect();
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    const rebuilt = build();
    fit();
    // warm-up: compile the slice material, and both line batches (empty ones are
    // hidden, so the first rim, shell or thrown trail would compile mid-drag),
    // once, so the first click or throw has no long frame
    if (rebuilt && stage) {
      const st = stage;
      const lines = [st.solid.object, st.dashed.object];
      const was = lines.map((l) => l.visible);
      lines.forEach((l) => (l.visible = true));
      st.fanout.warm(st.volumes[0], () => renderer.compile(scene, camera));
      lines.forEach((l, i) => (l.visible = was[i]));
    }
    loop.wake();
  }

  let firstAt = -1;
  let t = 0;
  let frames = 0;
  const governor = new DprGovernor(dpr, (d) => {
    renderer.setPixelRatio(d);
    renderer.setSize(w, h, false);
  });
  const loop = new Loop(renderer, o.hero, (_now, raw) => {
    if (!stage) return;
    const dt = clamp(raw / 1000, 0.001, 1 / 20);
    t += dt;
    if (firstAt < 0) firstAt = t;
    const energy = ix.tick(t, dt, t - firstAt, clamp(window.scrollY / h, 0, 1));
    renderer.render(scene, camera);
    if (++frames === 1) o.onReady();
    governor.sample(raw);
    // reduced motion: one composed frame, then sleep until something wakes the loop
    if (o.reduced && energy < 0.004 && frames > 2) loop.stop();
  });

  const ro = new ResizeObserver(resize);
  ro.observe(o.hero);
  document.fonts?.ready.then(() => {
    if (disposed) return;
    fit();
    loop.wake();
  });
  resize();
  loop.start();
  const unprobe = o.dev ? installProbe(() => stage, () => zones, loop, governor) : null;

  return {
    toggleFirst: () => {
      ix.toggleFirst();
      loop.wake();
    },
    dispose() {
      disposed = true;
      unprobe?.();
      loop.dispose();
      ro.disconnect();
      ix.dispose();
      labels.dispose();
      stage?.dispose();
      stage = null;
      shared.voxelGeo.dispose();
      shared.coreGeo.dispose();
      shared.metal.dispose();
      shared.core.dispose();
      shared.shadeTex.dispose();
      rough.dispose();
      envRT.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
