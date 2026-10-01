// Everything that depends on the layout (desktop 7 volumes / mobile 4): the
// volumes, the instanced voxels and cores, contact shades, line batches, the
// fan and the specks. Rebuilt wholesale when the layout switches.
import * as THREE from 'three';
import { Fanout } from './fanout';
import type { Layout } from './layout';
import { LineBatch } from './lines';
import { Shades } from './shade';
import { Specks } from './specks';
import { Volume } from './volume';

export interface Shared {
  voxelGeo: THREE.BufferGeometry;
  coreGeo: THREE.BufferGeometry;
  metal: THREE.MeshPhysicalMaterial;
  core: THREE.Material;
  shadeTex: THREE.Texture;
}

const MAX_VOXELS = 512;

export class Stage {
  readonly volumes: Volume[];
  readonly voxels: THREE.InstancedMesh;
  readonly cores: THREE.InstancedMesh;
  readonly shades: Shades;
  readonly solid = new LineBatch(1536, null);
  readonly dashed = new LineBatch(768, { dash: 0.08, gap: 0.06 });
  readonly fanout: Fanout;
  readonly specks: Specks | null;

  constructor(readonly layout: Layout, readonly field: THREE.Group, shared: Shared, reduced: boolean) {
    this.voxels = new THREE.InstancedMesh(shared.voxelGeo, shared.metal, MAX_VOXELS);
    this.cores = new THREE.InstancedMesh(shared.coreGeo, shared.core, MAX_VOXELS);
    for (const m of [this.voxels, this.cores]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
    }
    let used = 0;
    const alloc = (n: number) => {
      const s = used;
      used += n;
      return s;
    };
    this.volumes = layout.volumes.map(
      (spec, i) => new Volume(spec, i, { field, alloc }),
    );
    this.voxels.count = this.cores.count = Math.min(used, MAX_VOXELS);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < this.voxels.count; i++) this.voxels.setColorAt(i, white);
    this.shades = new Shades(this.volumes.length, shared.shadeTex);
    this.fanout = new Fanout(layout.mobile ? 4 : 6, reduced);
    this.fanout.prebuild(this.volumes);
    this.specks = layout.mobile ? null : new Specks(90);
    field.add(this.cores, this.voxels, this.shades.mesh, this.solid.object, this.dashed.object);
    if (this.specks) field.add(this.specks.points);
  }

  /** Flag every per-frame buffer for upload. */
  commit(): void {
    this.solid.end();
    this.dashed.end();
    this.shades.commit();
    this.voxels.instanceMatrix.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;
    if (this.voxels.instanceColor) this.voxels.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.fanout.dispose();
    for (const v of this.volumes) {
      v.pivot.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      v.pivot.removeFromParent();
    }
    this.voxels.removeFromParent();
    this.cores.removeFromParent();
    this.voxels.dispose();
    this.cores.dispose();
    this.shades.mesh.removeFromParent();
    this.shades.dispose();
    this.solid.object.removeFromParent();
    this.dashed.object.removeFromParent();
    this.solid.dispose();
    this.dashed.dispose();
    if (this.specks) {
      this.specks.points.removeFromParent();
      this.specks.dispose();
    }
  }
}
