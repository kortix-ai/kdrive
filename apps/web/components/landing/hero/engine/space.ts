// Screen ↔ field conversions for the hero (hero px, field space): projection,
// picking against each volume's box (no proxy meshes in the scene), the drag
// plane and the throw's world-space bounds.
import * as THREE from 'three';
import type { Zones } from './exclusion';
import type { Bounds, Volume } from './volume';

const _ray = new THREE.Ray();
const _local = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _box = new THREE.Box3();
const _p = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _nd = new THREE.Vector2();
const _rc = new THREE.Raycaster();

export class Space {
  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly field: THREE.Group,
    private readonly size: () => [number, number],
  ) {}

  /** Field point → hero px (x, y of the returned shared vector). */
  readonly project = (p: THREE.Vector3): THREE.Vector3 => {
    const [w, h] = this.size();
    _p.copy(p).applyMatrix4(this.field.matrixWorld).project(this.camera);
    return _p.set((_p.x * 0.5 + 0.5) * w, (-_p.y * 0.5 + 0.5) * h, _p.z);
  };

  /** The camera ray through a hero px, in field space. */
  private rayAt(x: number, y: number): THREE.Ray {
    const [w, h] = this.size();
    _rc.setFromCamera(_nd.set((x / w) * 2 - 1, -((y / h) * 2 - 1)), this.camera);
    return _ray.copy(_rc.ray).applyMatrix4(_inv.copy(this.field.matrixWorld).invert());
  }

  /** The nearest volume whose (slightly padded) box the ray at (x, y) hits. */
  pick(vols: Volume[], x: number, y: number): Volume | null {
    const ray = this.rayAt(x, y);
    let best: Volume | null = null;
    let bestD = Infinity;
    for (const v of vols) {
      _local.copy(ray).applyMatrix4(_inv.copy(v.pivot.matrix).invert());
      _box.min.copy(v.half).multiplyScalar(-1.06);
      _box.max.copy(v.half).multiplyScalar(1.06);
      if (!_local.intersectBox(_box, _hit)) continue;
      const dist = _hit.applyMatrix4(v.pivot.matrix).distanceTo(ray.origin);
      if (dist < bestD) { bestD = dist; best = v; }
    }
    return best;
  }

  /** Where the pointer meets the volume's home z plane (the drag plane). */
  dragPoint(v: Volume, x: number, y: number): THREE.Vector3 | null {
    _plane.constant = -v.home.z;
    return this.rayAt(x, y).intersectPlane(_plane, new THREE.Vector3());
  }

  /** The safe rect minus the nav band, in world units at the volume's depth, less its radius. */
  bounds(v: Volume, z: Zones, camZ: number): Bounds {
    const [w, h] = this.size();
    const halfH = (camZ - v.home.z) * Math.tan((this.camera.fov * Math.PI) / 360);
    const halfW = halfH * (w / h);
    const r = v.size * v.fit * 0.7;
    const wx = (px: number) => (px / w) * 2 * halfW - halfW;
    const wy = (py: number) => halfH - (py / h) * 2 * halfH;
    return {
      minX: wx(z.safe.x0) + r,
      maxX: wx(z.safe.x1) - r,
      minY: wy(z.safe.y1) + r,
      maxY: wy(z.nav.y1) - r,
      // the copy lines, grown by the radius: a thrown cube bounces off them, never flies under the text
      blocks: z.tight.map((c) => ({ minX: wx(c.x0) - r, maxX: wx(c.x1) + r, minY: wy(c.y1) - r, maxY: wy(c.y0) + r })),
    };
  }
}
