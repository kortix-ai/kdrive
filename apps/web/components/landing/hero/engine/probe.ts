// Dev-only probe for the screenshot harness (never in production builds):
// volume screen positions, fitted homes, the fan state and the loop state.
import type { Zones } from './exclusion';
import type { DprGovernor, Loop } from './loop';
import type { Stage } from './stage';

type Host = { __kdHero?: unknown };

export function installProbe(stage: () => Stage | null, zones: () => Zones, loop: Loop, gov: DprGovernor): () => void {
  const w = window as unknown as Host;
  w.__kdHero = {
    volumes: () => stage()?.volumes.map((v) => ({ name: v.spec.name, x: Math.round(v.screen.x), y: Math.round(v.screen.y), mode: v.mode })),
    homes: () => stage()?.volumes.map((v) => [v.spec.name, +v.home.x.toFixed(2), +v.home.y.toFixed(2), v.fit]),
    fan: () => {
      const f = stage()?.fanout;
      const p = f?.plan;
      return { vol: f?.vol?.spec.name ?? null, target: f?.target, side: p?.side, axis: p?.axis.toArray(), compact: p?.compact, spacing: p?.spacing, mode: p?.layout?.mode ?? null, attach: p?.layout?.attach, rows: p?.layout?.rows.length ?? 0, labels: p?.labels.map((l) => l.text) };
    },
    zones,
    running: () => loop.running,
    dpr: () => gov.dpr,
  };
  return () => {
    delete w.__kdHero;
  };
}
